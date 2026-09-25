"""Generate the redistributable, tagged ECDICT study pool from audited inputs."""

import csv
import hashlib
import json
import os
import re
from collections import Counter
from pathlib import Path


ROOT = Path.cwd()
OUTPUT = ROOT / "src" / "data" / "vocabularyExamRecords.ts"
TAG_MAP = {
    "cet4": "cet4",
    "cet6": "cet6",
    "toefl": "toefl",
    "ielts": "ielts",
    "ky": "postgrad",
}
WORD_PATTERN = re.compile(r"^[a-z][a-z'-]*$")
CHINESE_PATTERN = re.compile(r"[\u3400-\u9fff]")
IPA_VARIANT_PATTERN = re.compile(r"^/[^/]+/(?:,\s*/[^/]+/)*$")


def required_path(variable: str) -> Path:
    value = os.environ.get(variable)
    if not value:
        raise SystemExit(f"缺少环境变量 {variable}")
    path = Path(value)
    if not path.is_file():
        raise SystemExit(f"找不到输入文件：{path}")
    return path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_ipa(path: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    with path.open("r", encoding="utf-8-sig") as source:
        for line in source:
            word, separator, phonetic = line.rstrip("\r\n").partition("\t")
            word = word.strip().lower()
            phonetic = phonetic.strip()
            if separator and word and phonetic and IPA_VARIANT_PATTERN.fullmatch(phonetic):
                entries.setdefault(word, phonetic)
    return entries


def clean_meaning(raw: str) -> str:
    parts = []
    for line in re.split(r"\r?\n|[;；]+", raw or ""):
        value = re.sub(r"^\s*(?:n|v|vt|vi|adj|a|adv|ad|prep|conj|pron)\.\s*", "", line, flags=re.I)
        value = re.sub(r"\s+", " ", value).strip(" ,，;；")
        if value and value not in parts:
            parts.append(value)
    return "；".join(parts[:5])[:180]


def clean_definition(raw: str) -> str:
    return re.sub(r"\s+", " ", raw or "").strip()[:500]


def part_of_speech(row: dict[str, str]) -> str:
    source = f"{row.get('pos', '')} {row.get('translation', '')}".lower()
    mappings = (
        ("noun", r"\bn\.|\bnoun\b"),
        ("verb", r"\b(?:v|vt|vi)\.|\bverb\b"),
        ("adjective", r"\b(?:adj|a)\.|\badjective\b"),
        ("adverb", r"\b(?:adv|ad)\.|\badverb\b"),
        ("preposition", r"\bprep\.|\bpreposition\b"),
        ("conjunction", r"\bconj\.|\bconjunction\b"),
        ("pronoun", r"\bpron\.|\bpronoun\b"),
    )
    for value, pattern in mappings:
        if re.search(pattern, source):
            return value
    return "other"


def frequency_level(raw: str) -> tuple[str, str]:
    try:
        rank = int(raw)
    except (TypeError, ValueError):
        rank = 0
    if 0 < rank <= 2000:
        return "A2", "beginner"
    if 2000 < rank <= 6000:
        return "B1", "intermediate"
    if 6000 < rank <= 15000:
        return "B2", "intermediate"
    return "C1", "advanced"


def main() -> None:
    ecdict_path = required_path("PROOFLINE_ECDICT_CSV")
    ipa_us_path = required_path("PROOFLINE_IPA_DICT_US")
    ipa_uk_path = required_path("PROOFLINE_IPA_DICT_UK")
    pronunciations = read_ipa(ipa_us_path)
    for word, phonetic in read_ipa(ipa_uk_path).items():
        pronunciations.setdefault(word, phonetic)

    records: dict[str, dict[str, object]] = {}
    skipped = Counter()
    with ecdict_path.open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            word = (row.get("word") or "").strip().lower()
            tags = sorted({TAG_MAP[tag] for tag in (row.get("tag") or "").lower().split() if tag in TAG_MAP})
            if not tags:
                continue
            if not WORD_PATTERN.fullmatch(word):
                skipped["invalid_word"] += 1
                continue
            meaning = clean_meaning(row.get("translation", ""))
            if not meaning or not CHINESE_PATTERN.search(meaning):
                skipped["missing_chinese"] += 1
                continue
            definition = clean_definition(row.get("definition", ""))
            if not definition:
                skipped["missing_english"] += 1
                continue
            phonetic = pronunciations.get(word)
            if not phonetic:
                skipped["missing_ipa"] += 1
                continue
            if phonetic.strip("/ ").replace(",", "").lower() == word:
                skipped["ipa_equals_word"] += 1
                continue

            level, difficulty = frequency_level(row.get("frq", ""))
            records[word] = {
                "word": word,
                "phonetic": phonetic,
                "meaning": meaning,
                "definitionEn": definition,
                "partOfSpeech": part_of_speech(row),
                "level": level,
                "difficulty": difficulty,
                "frequencyRank": int(row["frq"]) if (row.get("frq") or "").isdigit() else None,
                "examTags": tags,
            }

    rows = [records[word] for word in sorted(records)]
    tag_counts = Counter(tag for row in rows for tag in row["examTags"])
    meta = {
        "name": "ECDICT exam-tagged study words",
        "version": "2026-09-25",
        "sourceUrl": "https://github.com/skywind3000/ECDICT",
        "sourceFileUrl": "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv",
        "license": "Repository MIT license; upstream dictionary components and crawled material require per-item provenance review",
        "attribution": "ECDICT by Linwei; retain its LICENSE and README attribution",
        "redistributionStatus": "review-required",
        "inputSha256": sha256(ecdict_path),
        "ipaSourceUrl": "https://github.com/open-dict-data/ipa-dict",
        "ipaUsSha256": sha256(ipa_us_path),
        "ipaUkSha256": sha256(ipa_uk_path),
        "ipaNote": "US IPA-Dict preferred; UK IPA-Dict fills gaps. Entries without a valid pronunciation are omitted.",
        "selectionNote": "Only explicit ECDICT exam tags are used. This is a third-party learning pool, not an official exam syllabus.",
        "recordCount": len(rows),
        "directionCounts": dict(sorted(tag_counts.items())),
        "skipped": dict(sorted(skipped.items())),
    }
    generated = (
        "/* eslint-disable */\n"
        "/** Generated from ECDICT tagged rows and ipa-dict; see docs/vocabulary-sources.md. */\n"
        "export interface EcdictExamVocabularyRecord {\n"
        "  word: string; phonetic: string; meaning: string; definitionEn: string;\n"
        "  partOfSpeech: string; level: 'A2' | 'B1' | 'B2' | 'C1';\n"
        "  difficulty: 'beginner' | 'intermediate' | 'advanced'; frequencyRank: number | null;\n"
        "  examTags: Array<'cet4' | 'cet6' | 'toefl' | 'ielts' | 'postgrad'>;\n"
        "}\n"
        f"export const ECDICT_EXAM_SOURCE = {json.dumps(meta, ensure_ascii=False, indent=2)} as const;\n"
        "export const ECDICT_EXAM_RECORDS: readonly EcdictExamVocabularyRecord[] = "
        f"{json.dumps(rows, ensure_ascii=False, separators=(',', ':'))};\n"
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(generated, encoding="utf-8", newline="\n")
    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
