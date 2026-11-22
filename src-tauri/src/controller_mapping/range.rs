use serde::{Deserialize, Serialize};
use specta::Type;

/// A continuous target's legal scale as reported by the score page.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerRange {
    pub min: f64,
    pub max: f64,
    pub step: Option<f64>,
    pub step_base: f64,
}

impl ControllerRange {
    pub(super) fn valid(self) -> bool {
        self.min.is_finite()
            && self.max.is_finite()
            && self.max >= self.min
            && (self.max - self.min).is_finite()
            && self.step_base.is_finite()
            && self.step.is_none_or(|step| step.is_finite() && step > 0.0)
            && self.has_legal_value(self.min, self.max)
    }

    fn has_legal_value(self, min: f64, max: f64) -> bool {
        let Some(step) = self.step else { return true };
        let lower = (min - self.step_base) / step;
        let upper = (max - self.step_base) / step;
        let tolerance = |index: f64| index.abs().max(1.0) * f64::EPSILON * 2.0;
        lower.is_finite()
            && upper.is_finite()
            && (lower - tolerance(lower)).ceil() <= (upper + tolerance(upper)).floor()
    }
}

/// Input and output intervals configured independently for one mapping.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerMappingRange {
    pub input_min: f64,
    pub input_max: f64,
    pub target_min: f64,
    pub target_max: f64,
    pub reversed: bool,
}

impl ControllerMappingRange {
    pub(super) fn new(target: ControllerRange, input_min: f64, input_max: f64) -> Self {
        Self {
            input_min,
            input_max,
            target_min: target.min,
            target_max: target.max,
            reversed: false,
        }
    }

    pub(super) fn valid_for(self, target: ControllerRange) -> bool {
        target.valid()
            && self.input_min.is_finite()
            && self.input_max.is_finite()
            && self.input_max > self.input_min
            && (self.input_max - self.input_min).is_finite()
            && self.target_min >= target.min
            && self.target_max <= target.max
            && self.target_min <= self.target_max
            && target.has_legal_value(self.target_min, self.target_max)
    }
}
