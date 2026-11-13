use super::MAX_TEXT_BYTES;

const MAX_UTF16_UNITS: usize = 32_768;
const MAX_NESTING: usize = 128;

/// A display-only projection from a tool argument object. The full tool
/// arguments are assembled and validated separately before any tool runs.
pub(super) struct PublicToolText {
    field: &'static str,
    state: Scan,
    text: String,
    utf16_units: usize,
}

enum Scan {
    Object,
    Field,
    Key {
        matched_bytes: Option<usize>,
        escape: Escape,
    },
    Colon(bool),
    Value(bool),
    IgnoredString(Escape),
    IgnoredCompound(Compound),
    IgnoredScalar,
    Separator,
    PublicString(Escape),
    Done,
}

impl PublicToolText {
    pub(super) fn new(field: &'static str) -> Self {
        Self {
            field,
            state: Scan::Object,
            text: String::new(),
            utf16_units: 0,
        }
    }

    pub(super) fn push(&mut self, fragment: &str) {
        for character in fragment.chars() {
            if matches!(self.state, Scan::Done) {
                break;
            }
            self.advance(character);
        }
    }

    pub(super) fn text(&self) -> &str {
        &self.text
    }

    fn advance(&mut self, character: char) {
        let whitespace = matches!(character, ' ' | '\t' | '\r' | '\n');
        self.state = match &mut self.state {
            Scan::Object if character == '{' => Scan::Field,
            Scan::Field if character == '"' => Scan::Key {
                matched_bytes: Some(0),
                escape: Escape::default(),
            },
            Scan::Key {
                matched_bytes,
                escape,
            } => match escape.push(character) {
                StringStep::Character(value) => {
                    *matched_bytes = matched_bytes
                        .filter(|offset| self.field[*offset..].starts_with(value))
                        .map(|offset| offset + value.len_utf8());
                    return;
                }
                StringStep::More => return,
                StringStep::End => Scan::Colon(*matched_bytes == Some(self.field.len())),
                StringStep::Invalid => Scan::Done,
            },
            Scan::Colon(target) if character == ':' => Scan::Value(*target),
            Scan::Value(target) if character == '"' => {
                if *target {
                    Scan::PublicString(Escape::default())
                } else {
                    Scan::IgnoredString(Escape::default())
                }
            }
            Scan::Value(false) if matches!(character, '{' | '[') => {
                Scan::IgnoredCompound(Compound::new(character))
            }
            Scan::Value(false) if matches!(character, '-' | '0'..='9' | 't' | 'f' | 'n') => {
                Scan::IgnoredScalar
            }
            Scan::IgnoredString(escape) => match escape.push(character) {
                StringStep::End => Scan::Separator,
                StringStep::Invalid => Scan::Done,
                _ => return,
            },
            Scan::IgnoredCompound(compound) => match compound.push(character) {
                CompoundStep::More => return,
                CompoundStep::End => Scan::Separator,
                CompoundStep::Invalid => Scan::Done,
            },
            Scan::IgnoredScalar | Scan::Separator if character == ',' => Scan::Field,
            Scan::IgnoredScalar if whitespace => Scan::Separator,
            Scan::IgnoredScalar
                if character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.') =>
            {
                return;
            }
            Scan::PublicString(escape) => match escape.push(character) {
                StringStep::Character(value)
                    if self.text.len() + value.len_utf8() <= MAX_TEXT_BYTES
                        && self.utf16_units + value.len_utf16() <= MAX_UTF16_UNITS =>
                {
                    self.text.push(value);
                    self.utf16_units += value.len_utf16();
                    return;
                }
                StringStep::More => return,
                _ => Scan::Done,
            },
            Scan::Object | Scan::Field | Scan::Colon(_) | Scan::Value(_) | Scan::Separator
                if whitespace =>
            {
                return;
            }
            _ => Scan::Done,
        };
    }
}

struct Compound {
    delimiters: Vec<char>,
    string: Option<Escape>,
}

enum CompoundStep {
    More,
    End,
    Invalid,
}

impl Compound {
    fn new(opener: char) -> Self {
        Self {
            delimiters: vec![opener],
            string: None,
        }
    }

    fn push(&mut self, character: char) -> CompoundStep {
        if let Some(escape) = &mut self.string {
            match escape.push(character) {
                StringStep::End => self.string = None,
                StringStep::Invalid => return CompoundStep::Invalid,
                _ => (),
            }
            return CompoundStep::More;
        }
        match character {
            '"' => self.string = Some(Escape::default()),
            '{' | '[' if self.delimiters.len() >= MAX_NESTING => return CompoundStep::Invalid,
            '{' | '[' => self.delimiters.push(character),
            '}' | ']' => {
                let opener = if character == '}' { '{' } else { '[' };
                if self.delimiters.pop() != Some(opener) {
                    return CompoundStep::Invalid;
                }
                if self.delimiters.is_empty() {
                    return CompoundStep::End;
                }
            }
            _ => (),
        }
        CompoundStep::More
    }
}

/// Complete escape sequences contain at most two `\uXXXX` units. Retain
/// that small prefix across fragments and let serde validate the character.
#[derive(Default)]
struct Escape {
    bytes: [u8; 12],
    len: usize,
}

enum StringStep {
    More,
    Character(char),
    End,
    Invalid,
}

impl Escape {
    fn push(&mut self, character: char) -> StringStep {
        if self.len == 0 {
            return match character {
                '"' => StringStep::End,
                '\\' => {
                    self.bytes[0] = b'\\';
                    self.len = 1;
                    StringStep::More
                }
                '\0'..='\u{1f}' => StringStep::Invalid,
                _ => StringStep::Character(character),
            };
        }

        if !character.is_ascii() {
            return StringStep::Invalid;
        }
        self.bytes[self.len] = character as u8;
        self.len += 1;
        let valid = match self.len {
            2 => true,
            7 => character == '\\',
            8 => character == 'u',
            _ => character.is_ascii_hexdigit(),
        };
        if !valid {
            return StringStep::Invalid;
        }
        let complete = match self.len {
            2 => character != 'u',
            6 => {
                !self.bytes[2].eq_ignore_ascii_case(&b'D')
                    || !matches!(
                        self.bytes[3].to_ascii_uppercase(),
                        b'8' | b'9' | b'A' | b'B'
                    )
            }
            12 => true,
            _ => false,
        };
        if !complete {
            return StringStep::More;
        }

        let mut quoted = [b'"'; 14];
        quoted[1..=self.len].copy_from_slice(&self.bytes[..self.len]);
        let decoded = serde_json::from_slice(&quoted[..self.len + 2]);
        self.len = 0;
        match decoded {
            Ok(value) => StringStep::Character(value),
            Err(_) => StringStep::Invalid,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::PublicToolText;

    #[test]
    fn publishes_only_the_named_top_level_string_across_fragment_boundaries() {
        let mut preview = PublicToolText::new("plan");
        preview.push(r#" {"reason":[{"plan":"private", "bracket":"]}"}],"pl"#);
        assert_eq!(preview.text(), "");
        preview.push(r#"\u0061n" : "演奏\n"#);
        assert_eq!(preview.text(), "演奏\n");
        preview.push(r"\uD83");
        assert_eq!(preview.text(), "演奏\n");
        preview.push(r#"D\uDE00 \""#);
        assert_eq!(preview.text(), "演奏\n😀 \"");
        preview.push(r#"end","other":"hidden"}"#);
        assert_eq!(preview.text(), "演奏\n😀 \"end");
    }

    #[test]
    fn rejects_unpaired_surrogates_without_losing_the_valid_prefix() {
        for invalid in [r"\uD800x", r"\uDE00", r"\q"] {
            let mut preview = PublicToolText::new("answer");
            preview.push(r#"{"answer":"First "#);
            preview.push(invalid);
            preview.push("private");
            assert_eq!(preview.text(), "First ");
        }
    }

    #[test]
    fn stops_at_whole_unicode_scalars_within_both_reply_bounds() {
        let mut preview = PublicToolText::new("answer");
        preview.push(r#"{"answer":""#);
        preview.push(&"a".repeat(32767));
        preview.push("😀a");
        assert_eq!(preview.text().len(), 32767);

        let mut preview = PublicToolText::new("answer");
        preview.push(r#"{"answer":""#);
        preview.push(&"界".repeat(22000));
        assert_eq!(preview.text().len(), 65535);
    }
}
