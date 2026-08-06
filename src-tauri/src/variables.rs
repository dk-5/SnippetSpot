use chrono::{DateTime, Local};

pub fn expand_variables(text: &str, clipboard: Option<&str>) -> String {
    let now = Local::now();
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        match rest.find("{{") {
            None => {
                out.push_str(rest);
                return out;
            }
            Some(start) => {
                out.push_str(&rest[..start]);
                let after = &rest[start + 2..];
                match after.find("}}") {
                    None => {
                        out.push_str(&rest[start..]);
                        return out;
                    }
                    Some(end) => {
                        let placeholder = &after[..end];
                        out.push_str(&expand_placeholder(placeholder, &now, clipboard));
                        rest = &after[end + 2..];
                    }
                }
            }
        }
    }
}

fn expand_placeholder(
    placeholder: &str,
    now: &DateTime<Local>,
    clipboard: Option<&str>,
) -> String {
    match placeholder {
        "date" => now.format("%Y-%m-%d").to_string(),
        "time" => now.format("%H:%M").to_string(),
        "datetime" => now.format("%Y-%m-%d %H:%M").to_string(),
        "clipboard" => clipboard.map(str::to_string).unwrap_or_else(|| original(placeholder)),
        _ => {
            if let Some(rest) = placeholder.strip_prefix("env:") {
                if let Some((name, default)) = rest.split_once(':') {
                    return std::env::var(name).unwrap_or_else(|_| default.to_string());
                }
                return std::env::var(rest).unwrap_or_default();
            }
            original(placeholder)
        }
    }
}

fn original(placeholder: &str) -> String {
    let mut s = String::with_capacity(placeholder.len() + 4);
    s.push_str("{{");
    s.push_str(placeholder);
    s.push_str("}}");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_time_datetime_formats() {
        let date = expand_variables("{{date}}", None);
        assert_eq!(date.len(), 10);
        assert_eq!(date.as_bytes()[4], b'-');
        assert_eq!(date.as_bytes()[7], b'-');

        let time = expand_variables("{{time}}", None);
        assert_eq!(time.len(), 5);
        assert_eq!(time.as_bytes()[2], b':');

        let datetime = expand_variables("{{datetime}}", None);
        assert_eq!(datetime.len(), 16);
        assert_eq!(datetime.as_bytes()[10], b' ');
    }

    #[test]
    fn clipboard_placeholder() {
        assert_eq!(expand_variables("{{clipboard}}", Some("hello")), "hello");
        assert_eq!(expand_variables("x {{clipboard}} y", Some("hi")), "x hi y");
        assert_eq!(expand_variables("{{clipboard}}", None), "{{clipboard}}");
    }

    #[test]
    fn env_placeholder() {
        let key = "SNIPPETSPOT_TEST_VAR";
        unsafe { std::env::set_var(key, "env-value") };
        assert_eq!(expand_variables(&format!("{{{{env:{key}}}}}"), None), "env-value");
        unsafe { std::env::remove_var(key) };
        assert_eq!(expand_variables(&format!("{{{{env:{key}}}}}"), None), "");
    }

    #[test]
    fn env_placeholder_with_default() {
        let key = "SNIPPETSPOT_TEST_VAR_DEFAULT";
        unsafe { std::env::remove_var(key) };
        assert_eq!(
            expand_variables(&format!("{{{{env:{key}:fallback}}}}"), None),
            "fallback"
        );
        unsafe { std::env::set_var(key, "custom") };
        assert_eq!(
            expand_variables(&format!("{{{{env:{key}:fallback}}}}"), None),
            "custom"
        );
        unsafe { std::env::remove_var(key) };
    }

    #[test]
    fn unknown_placeholder_unchanged() {
        assert_eq!(expand_variables("{{unknown}}", None), "{{unknown}}");
        assert_eq!(expand_variables("a {{unknown}} b", None), "a {{unknown}} b");
    }

    #[test]
    fn multiple_and_inline() {
        let expanded = expand_variables("{{date}}|{{time}}", None);
        let (date, time) = expanded.split_once('|').expect("expected a pipe separator");
        assert_eq!(date.len(), 10);
        assert_eq!(date.as_bytes()[4], b'-');
        assert_eq!(date.as_bytes()[7], b'-');
        assert_eq!(time.len(), 5);
        assert_eq!(time.as_bytes()[2], b':');
        assert_eq!(
            expand_variables("before{{clipboard}}after", Some("X")),
            "beforeXafter"
        );
    }

    #[test]
    fn unclosed_placeholder_unchanged() {
        assert_eq!(expand_variables("prefix {{date", None), "prefix {{date");
        assert_eq!(expand_variables("{{date", None), "{{date");
    }

    #[test]
    fn empty_and_plain_text() {
        assert_eq!(expand_variables("", None), "");
        assert_eq!(expand_variables("plain text", None), "plain text");
    }
}
