//! Plain-text extraction from documents, bounded in size and never trusted to behave.

use std::fs::File;
use std::io::{BufReader, Cursor, Read};
use std::path::Path;

use calamine::{open_workbook_auto_from_rs, Reader as _};
use quick_xml::events::Event;
use quick_xml::Reader;

/// Files larger than this are not opened at all.
pub const MAX_FILE_BYTES: u64 = 40 * 1024 * 1024;
/// At most this many characters of text are kept per document.
pub const MAX_TEXT_CHARS: usize = 32_000;

#[derive(Debug)]
pub enum Extracted {
    Text(String),
    /// Format we don't read (e.g. legacy binary .doc) or file too large.
    Unsupported,
}

pub fn extract(path: &Path, ext: &str) -> Result<Extracted, String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > MAX_FILE_BYTES {
        return Ok(Extracted::Unsupported);
    }
    let mut text = Collector::default();
    match ext {
        "pdf" => pdf(path, &mut text)?,
        "docx" | "docm" | "dotx" => zip_xml(path, &mut text, |n| n == "word/document.xml")?,
        "pptx" | "pptm" | "ppsx" => zip_xml(path, &mut text, |n| {
            n.starts_with("ppt/slides/slide") && n.ends_with(".xml")
        })?,
        "odt" | "odp" => zip_xml(path, &mut text, |n| n == "content.xml")?,
        "xlsx" | "xlsm" | "xlsb" | "xls" | "ods" => spreadsheet(path, &mut text)?,
        "csv" => plain(path, &mut text)?,
        "rtf" => rtf(path, &mut text)?,
        _ => return Ok(Extracted::Unsupported),
    }
    Ok(Extracted::Text(text.finish()))
}

/// Accumulates text with collapsed whitespace, stopping at [`MAX_TEXT_CHARS`].
#[derive(Default)]
struct Collector {
    out: String,
    chars: usize,
    pending_space: bool,
}

impl Collector {
    fn full(&self) -> bool {
        self.chars >= MAX_TEXT_CHARS
    }

    fn push(&mut self, s: &str) {
        for c in s.chars() {
            if self.full() {
                return;
            }
            if c.is_whitespace() || c.is_control() {
                self.pending_space = !self.out.is_empty();
                continue;
            }
            if self.pending_space {
                if self.chars + 2 > MAX_TEXT_CHARS {
                    self.chars = MAX_TEXT_CHARS; // no room for a space and a character
                    return;
                }
                self.out.push(' ');
                self.chars += 1;
                self.pending_space = false;
            }
            self.out.push(c);
            self.chars += 1;
        }
    }

    fn space(&mut self) {
        self.pending_space = !self.out.is_empty();
    }

    fn finish(self) -> String {
        self.out
    }
}

fn pdf(path: &Path, text: &mut Collector) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let pages = pdf_extract::extract_text_from_mem_by_pages(&bytes).map_err(|e| e.to_string())?;
    for page in pages {
        text.push(&page);
        text.space();
        if text.full() {
            break;
        }
    }
    Ok(())
}

/// Reads the XML parts of an Office Open XML / OpenDocument zip that hold the body text.
fn zip_xml(path: &Path, text: &mut Collector, wanted: impl Fn(&str) -> bool) -> Result<(), String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = zip
        .file_names()
        .filter(|n| wanted(n))
        .map(str::to_string)
        .collect();
    // slide2.xml before slide10.xml
    names.sort_by_key(|n| {
        let digits: String = n.chars().filter(char::is_ascii_digit).collect();
        (digits.parse::<u32>().unwrap_or(0), n.clone())
    });
    for name in names {
        if text.full() {
            break;
        }
        let mut entry = zip.by_name(&name).map_err(|e| e.to_string())?;
        // Guard against zip bombs: never inflate more than 16 MB of XML per part.
        let mut xml = Vec::new();
        (&mut entry)
            .take(16 * 1024 * 1024)
            .read_to_end(&mut xml)
            .map_err(|e| e.to_string())?;
        xml_text(&xml, text)?;
    }
    Ok(())
}

/// Collects character data, adding a space at the end of paragraphs, rows and breaks.
fn xml_text(xml: &[u8], text: &mut Collector) -> Result<(), String> {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    loop {
        if text.full() {
            return Ok(());
        }
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(t)) => text.push(&t.into_inner()),
            Ok(Event::CData(t)) => text.push(&t.into_inner()),
            Ok(Event::GeneralRef(r)) => {
                let c = match r.resolve_char_ref() {
                    Ok(Some(c)) => Some(c),
                    _ => match r.into_inner().as_ref() {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "quot" => Some('"'),
                        "apos" => Some('\''),
                        _ => None,
                    },
                };
                if let Some(c) = c {
                    text.push(c.encode_utf8(&mut [0; 4]));
                }
            }
            Ok(Event::End(e)) => {
                if matches!(e.local_name().as_ref(), "p" | "h" | "tr" | "tc" | "br") {
                    text.space();
                }
            }
            Ok(Event::Empty(e)) => {
                if matches!(e.local_name().as_ref(), "br" | "tab" | "s" | "line-break") {
                    text.space();
                }
            }
            Ok(Event::Eof) => return Ok(()),
            Ok(_) => {}
            Err(e) => return Err(e.to_string()),
        }
        buf.clear();
    }
}

fn spreadsheet(path: &Path, text: &mut Collector) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut book = open_workbook_auto_from_rs(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    for name in book.sheet_names() {
        if text.full() {
            break;
        }
        text.push(&name);
        text.space();
        let Ok(range) = book.worksheet_range(&name) else {
            continue;
        };
        for row in range.rows() {
            for cell in row {
                let value = cell.to_string();
                if !value.is_empty() {
                    text.push(&value);
                    text.space();
                }
            }
            if text.full() {
                break;
            }
        }
    }
    Ok(())
}

fn plain(path: &Path, text: &mut Collector) -> Result<(), String> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take((MAX_TEXT_CHARS * 4) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    text.push(&String::from_utf8_lossy(&bytes));
    Ok(())
}

/// Minimal RTF reader: drops control words and destination groups, keeps visible text.
fn rtf(path: &Path, text: &mut Collector) -> Result<(), String> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(8 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let mut depth_skip: Option<usize> = None; // group depth at which an ignored destination began
    let mut depth = 0usize;
    let mut i = 0;
    let mut plain = String::new();
    while i < bytes.len() && !text.full() {
        match bytes[i] {
            b'{' => {
                depth += 1;
                if bytes.get(i + 1..i + 3) == Some(b"\\*") && depth_skip.is_none() {
                    depth_skip = Some(depth);
                }
                i += 1;
            }
            b'}' => {
                if depth_skip == Some(depth) {
                    depth_skip = None;
                }
                depth = depth.saturating_sub(1);
                i += 1;
            }
            b'\\' => {
                i += 1;
                match bytes.get(i) {
                    Some(b'\'') => {
                        // \'hh — a cp1252 byte
                        let hex = bytes
                            .get(i + 1..i + 3)
                            .and_then(|h| std::str::from_utf8(h).ok());
                        if let Some(b) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                            if depth_skip.is_none() {
                                plain.push(b as char);
                            }
                        }
                        i += 3;
                    }
                    Some(c) if c.is_ascii_alphabetic() => {
                        let start = i;
                        while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                            i += 1;
                        }
                        let word = &bytes[start..i];
                        while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'-') {
                            i += 1;
                        }
                        if i < bytes.len() && bytes[i] == b' ' {
                            i += 1;
                        }
                        if matches!(
                            word,
                            b"fonttbl" | b"colortbl" | b"stylesheet" | b"info" | b"pict"
                        ) && depth_skip.is_none()
                        {
                            depth_skip = Some(depth);
                        }
                        if matches!(word, b"par" | b"line" | b"tab" | b"cell" | b"row") {
                            plain.push(' ');
                        }
                    }
                    Some(&c) => {
                        if depth_skip.is_none() && matches!(c, b'\\' | b'{' | b'}') {
                            plain.push(c as char);
                        }
                        i += 1;
                    }
                    None => break,
                }
            }
            b'\r' | b'\n' => i += 1,
            c => {
                if depth_skip.is_none() {
                    plain.push(c as char);
                }
                i += 1;
            }
        }
        if plain.len() > 4096 {
            text.push(&plain);
            plain.clear();
        }
    }
    text.push(&plain);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_zip(path: &Path, parts: &[(&str, &str)]) {
        let file = File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        for (name, body) in parts {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }

    fn text_of(path: &Path, ext: &str) -> String {
        match extract(path, ext).unwrap() {
            Extracted::Text(t) => t,
            Extracted::Unsupported => panic!("unsupported"),
        }
    }

    #[test]
    fn reads_docx_paragraphs_and_entities() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.docx");
        write_zip(
            &p,
            &[(
                "word/document.xml",
                r#"<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Quarterly</w:t></w:r><w:r><w:t xml:space="preserve"> report</w:t></w:r></w:p><w:p><w:r><w:t>R&amp;D budget</w:t></w:r></w:p></w:body></w:document>"#,
            )],
        );
        assert_eq!(text_of(&p, "docx"), "Quarterly report R&D budget");
    }

    #[test]
    fn reads_pptx_slides_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.pptx");
        let slide = |t: &str| {
            format!(
                r#"<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>{t}</a:t></a:r></a:p></p:sld>"#
            )
        };
        write_zip(
            &p,
            &[
                ("ppt/slides/slide10.xml", &slide("ten")),
                ("ppt/slides/slide2.xml", &slide("two")),
                ("ppt/slideLayouts/slideLayout1.xml", &slide("layout")),
            ],
        );
        assert_eq!(text_of(&p, "pptx"), "two ten");
    }

    #[test]
    fn reads_rtf_text_only() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.rtf");
        std::fs::write(
            &p,
            r"{\rtf1\ansi{\fonttbl{\f0 Arial;}}{\*\generator Word;}\f0 Hello \b world\b0\par Caf\'e9}",
        )
        .unwrap();
        assert_eq!(text_of(&p, "rtf"), "Hello world Café");
    }

    #[test]
    fn caps_text_and_skips_legacy_formats() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big.csv");
        std::fs::write(&p, "word ".repeat(20_000)).unwrap();
        assert!(text_of(&p, "csv").chars().count() <= MAX_TEXT_CHARS);
        let legacy = dir.path().join("old.doc");
        std::fs::write(&legacy, b"\xD0\xCF\x11\xE0").unwrap();
        assert!(matches!(
            extract(&legacy, "doc").unwrap(),
            Extracted::Unsupported
        ));
    }

    #[test]
    fn broken_files_are_errors_not_panics() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("broken.docx");
        std::fs::write(&p, b"not a zip").unwrap();
        assert!(extract(&p, "docx").is_err());
        let pdf = dir.path().join("broken.pdf");
        std::fs::write(&pdf, b"%PDF-1.4 garbage").unwrap();
        assert!(extract(&pdf, "pdf").is_err());
    }
}
