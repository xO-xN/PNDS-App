use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1);
    let (Some(target), None) = (args.next(), args.next()) else {
        eprintln!("Usage: blank-template-export <new-output-directory>");
        return ExitCode::from(2);
    };
    match pnds_app_lib::export_blank_template(Path::new(&target)) {
        Ok(tag) => {
            println!("{tag}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("Could not export Blank: {}", error.detail);
            ExitCode::FAILURE
        }
    }
}
