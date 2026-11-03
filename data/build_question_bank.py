# -*- coding: utf-8 -*-
"""
SQL 시험문제 파서 및 SQLite 검증 스크립트
- 객관식 45문항 (기초 15, 활용 15, 응용 15)
- 주관식 45문항 (기초 15, 활용 15, 응용 15)
- 총 90문항 데이터셋 생성 및 연습용 SQLite 스키마/데이터 검증
"""
import json
import re
import sqlite3
from pathlib import Path

DOWNLOADS_DIR = Path(r"C:\Users\tuesv\Downloads\SQL시험문제")
OUT_DIR = Path(r"c:\DMDG_JOBs\DMDG_PRJ\sql_exam\data")
JS_DIR = Path(r"c:\DMDG_JOBs\DMDG_PRJ\sql_exam\js")

CHOICE_FILE = DOWNLOADS_DIR / "gemini-code-1793712215553.txt"
SUBJ_FILE = DOWNLOADS_DIR / "sql_master_45_question_bank.md"

SCHEMA_SQL = """
-- 실습용 대학교 데이터베이스 스키마 및 샘플 데이터 (SQLite 호환)
DROP TABLE IF EXISTS 수강;
DROP TABLE IF EXISTS 과목;
DROP TABLE IF EXISTS 학생;
DROP TABLE IF EXISTS 수강1;
DROP TABLE IF EXISTS 과목1;
DROP TABLE IF EXISTS 학생1;
DROP TABLE IF EXISTS 수강2;
DROP TABLE IF EXISTS 과목2;
DROP TABLE IF EXISTS 학생2;

CREATE TABLE 학생 (
    학번 CHAR(4) NOT NULL PRIMARY KEY,
    이름 VARCHAR(20) NOT NULL,
    주소 VARCHAR(50) DEFAULT '미정',
    학년 INT NOT NULL,
    나이 INT NULL,
    성별 CHAR(1) NOT NULL,
    휴대폰번호 CHAR(14) NULL,
    소속학과 VARCHAR(20) NULL
);

CREATE TABLE 과목 (
    과목번호 CHAR(4) NOT NULL PRIMARY KEY,
    이름 VARCHAR(20) NOT NULL,
    강의실 CHAR(5) NOT NULL,
    개설학과 VARCHAR(20) NOT NULL,
    시수 INT NOT NULL
);

CREATE TABLE 수강 (
    학번 CHAR(4) NOT NULL,
    과목번호 CHAR(4) NOT NULL,
    신청날짜 DATE NOT NULL,
    중간성적 INT DEFAULT 0,
    기말성적 INT DEFAULT 0,
    평가학점 CHAR(1) NULL,
    PRIMARY KEY (학번, 과목번호)
);

INSERT INTO 학생 VALUES ('s001', '김길동', '서울시 서초구', 4, 23, '남', '010-1111-2222', '컴퓨터');
INSERT INTO 학생 VALUES ('s002', '홍길순', '경기도 성남시', 1, 20, '여', NULL, '컴퓨터');
INSERT INTO 학생 VALUES ('s003', '이은진', '서울시 강남구', 2, 21, '여', '010-2222-3333', '컴퓨터');
INSERT INTO 학생 VALUES ('s004', '박민수', '서울시 마포구', 3, 24, '남', '010-3333-4444', '정보통신');
INSERT INTO 학생 VALUES ('s005', '정수아', '부산시 해운대구', 4, 25, '여', NULL, '정보통신');
INSERT INTO 학생 VALUES ('s006', '최영희', '서울시 송파구', 2, 22, '여', '010-5555-6666', '경영');
INSERT INTO 학생 VALUES ('s007', '강동원', '인천시 연수구', 1, 19, '남', '010-7777-8888', '컴퓨터');
INSERT INTO 학생 VALUES ('s008', '윤서연', '서울시 종로구', 3, 23, '여', '010-8888-9999', '경영');

INSERT INTO 과목 VALUES ('c001', '데이터베이스', '126', '컴퓨터', 3);
INSERT INTO 과목 VALUES ('c002', '정보보호', '137', '정보통신', 3);
INSERT INTO 과목 VALUES ('c003', '모바일웹', '128', '컴퓨터', 3);
INSERT INTO 과목 VALUES ('c004', '철학개론', '117', '철학', 2);
INSERT INTO 과목 VALUES ('c005', '전공글쓰기', '120', '교양학부', 1);

INSERT INTO 수강 VALUES ('s001', 'c002', '2026-03-03', 93, 98, 'A');
INSERT INTO 수강 VALUES ('s004', 'c001', '2026-03-05', 75, 78, 'C');
INSERT INTO 수강 VALUES ('s003', 'c002', '2026-03-06', 85, 82, 'B');
INSERT INTO 수강 VALUES ('s002', 'c001', '2026-03-10', 92, 95, 'A');
INSERT INTO 수강 VALUES ('s001', 'c001', '2026-03-15', 88, 91, 'A');
INSERT INTO 수강 VALUES ('s005', 'c003', '2026-03-12', 80, 84, 'B');
INSERT INTO 수강 VALUES ('s006', 'c004', '2026-03-18', 70, 74, 'C');

-- DML(UPDATE/DELETE) 및 DDL(ALTER) 문제 테스트용 복제 테이블
CREATE TABLE 학생1 AS SELECT * FROM 학생;
CREATE TABLE 과목1 AS SELECT * FROM 과목;
CREATE TABLE 수강1 AS SELECT * FROM 수강;

CREATE TABLE 학생2 (
    학번 CHAR(6) NOT NULL PRIMARY KEY,
    이름 VARCHAR(20) NOT NULL,
    학년 INT NOT NULL
);
INSERT INTO 학생2 VALUES ('s001', '김길동', 4);
""".strip()


def clean_latex_and_md(text: str) -> str:
    text = text.replace("$\\rightarrow$", "→")
    text = text.replace("$N \\times M$", "N × M")
    text = text.replace("$O(\\log N)$", "O(log N)")
    text = text.replace("$N$", "N").replace("$M$", "M").replace("$x$", "x")
    return text.strip()


def parse_choice_questions():
    raw = CHOICE_FILE.read_text(encoding="utf-8")
    # Split by ### Q<num>.
    pattern = re.compile(
        r"### Q(\d+)\.\s*(.+?)\n"
        r"1\.\s*(.+?)\n"
        r"2\.\s*(.+?)\n"
        r"3\.\s*(.+?)\n"
        r"4\.\s*(.+?)\n\s*"
        r"\*\*정답:\*\*\s*(\d+)\s*\n"
        r"\*\*해설:\*\*\s*(.+?)(?=\n---|\Z)",
        re.DOTALL,
    )
    questions = []
    for m in pattern.finditer(raw):
        qnum = int(m.group(1))
        if qnum > 45:
            continue
        title = clean_latex_and_md(m.group(2))
        opts = [clean_latex_and_md(m.group(i)) for i in range(3, 7)]
        ans = int(m.group(7))
        expl = clean_latex_and_md(m.group(8))

        if qnum <= 15:
            cat = "SQL 기초"
            cat_code = "CH05"
            idx = qnum
            qid = f"B-C-{idx:02d}"
        elif qnum <= 30:
            cat = "SQL 활용"
            cat_code = "CH06"
            idx = qnum - 15
            qid = f"U-C-{idx:02d}"
        else:
            cat = "SQL 응용"
            cat_code = "CH07"
            idx = qnum - 30
            qid = f"A-C-{idx:02d}"

        questions.append({
            "id": qid,
            "no": qnum,
            "category": cat,
            "chapter": cat_code,
            "type": "choice",
            "timeLimit": 60,  # 객관식 1분 (60초)
            "points": 2,
            "title": title,
            "description": "",
            "options": opts,
            "answer": ans,
            "explanation": expl,
        })
    return questions


# Subjective grading rules per question number (1..45)
SUBJ_GRADING_META = {
    1: {
        "grading": "state",
        "setupDrop": "DROP TABLE IF EXISTS 학생;",
        "checkSql": "SELECT name, type, [notnull], pk FROM pragma_table_info('학생') ORDER BY cid;",
        "keywords": ["CREATE TABLE", "학생", "학번", "이름", "PRIMARY KEY", "NOT NULL", "DEFAULT"],
    },
    2: {"grading": "result", "orderMatters": False, "keywords": ["SELECT", "DISTINCT", "소속학과", "FROM", "학생"]},
    3: {"grading": "result", "orderMatters": False, "keywords": ["SELECT", "이름", "학년", "소속학과", "휴대폰번호", "WHERE", "AND", "컴퓨터"]},
    4: {"grading": "result", "orderMatters": False, "keywords": ["SELECT", "BETWEEN", "1", "3", "NOT", "컴퓨터"]},
    5: {"grading": "result", "orderMatters": True, "keywords": ["SELECT", "FROM", "학생", "ORDER BY", "학년", "이름", "DESC"]},
    6: {"grading": "result", "orderMatters": False, "keywords": ["SELECT", "AVG", "나이", "AS", "여학생 평균나이", "WHERE", "여"]},
    7: {"grading": "result", "orderMatters": False, "keywords": ["SELECT", "학년", "COUNT", "GROUP BY", "HAVING", "2"]},
    8: {"grading": "result", "orderMatters": True, "keywords": ["SELECT", "이름", "주소", "학년", "LIKE", "%서울%", "ORDER BY", "DESC"]},
    9: {"grading": "result", "orderMatters": False, "keywords": ["SELECT", "이름", "휴대폰번호", "WHERE", "IS NULL"]},
    10: {"grading": "result", "orderMatters": False, "keywords": ["SELECT", "학번", "학생", "성별", "여", "UNION", "수강", "평가학점", "A"]},
    11: {"grading": "result", "orderMatters": False, "keywords": ["SELECT", "이름", "학생", "IN", "수강", "c002"]},
    12: {"grading": "result", "orderMatters": False, "keywords": ["SELECT", "학생", "JOIN", "수강", "ON", "학번"]},
    13: {"grading": "result", "orderMatters": False, "keywords": ["SELECT", "학번", "이름", "평가학점", "LEFT", "JOIN", "수강"]},
    14: {
        "grading": "state",
        "checkSql": "SELECT 학번, 이름, 학년 FROM 학생1 WHERE 이름 = '이은진';",
        "keywords": ["UPDATE", "학생1", "SET", "학년", "3", "WHERE", "이은진"],
    },
    15: {
        "grading": "state",
        "checkSql": "SELECT 과목번호 FROM 과목1 ORDER BY 과목번호;",
        "keywords": ["DELETE", "FROM", "과목1", "WHERE", "과목번호", "IN", "수강1", "GROUP BY", "HAVING", "COUNT"],
    },
    16: {
        "grading": "state",
        "setupDrop": "DROP TABLE IF EXISTS 과목2;",
        "checkSql": "SELECT name, [notnull], pk FROM pragma_table_info('과목2') ORDER BY cid;",
        "keywords": ["CREATE TABLE", "과목2", "과목번호", "이름", "강의실", "개설학과", "시수", "PRIMARY KEY", "NOT NULL"],
    },
    17: {
        "grading": "state",
        "setupDrop": "DROP TABLE IF EXISTS 수강2; CREATE TABLE IF NOT EXISTS 과목2 (과목번호 CHAR(4) PRIMARY KEY);",
        "checkSql": "SELECT name, [notnull], pk FROM pragma_table_info('수강2') ORDER BY cid;",
        "keywords": ["CREATE TABLE", "수강2", "PRIMARY KEY", "학번", "과목번호", "FOREIGN KEY", "REFERENCES", "학생2", "과목2"],
    },
    18: {
        "grading": "state",
        "checkSql": "SELECT name, [notnull], dflt_value FROM pragma_table_info('학생2') WHERE name = '등록날짜';",
        "keywords": ["ALTER TABLE", "학생2", "ADD", "등록날짜", "DATETIME", "NOT NULL", "DEFAULT", "2019-12-30"],
    },
    19: {
        "grading": "keyword",
        "keywords": ["ALTER TABLE", "학생2", "DROP", "등록날짜"],
    },
    20: {
        "grading": "keyword",
        "keywords": ["외래키", "수강2", "과목2", "DROP TABLE"],
    },
    21: {
        "grading": "keyword",
        "keywords": ["CREATE USER", "user4", "%", "IDENTIFIED BY", "4444"],
    },
    22: {
        "grading": "keyword",
        "keywords": ["GRANT", "ALL", "*.*", "manager", "%", "WITH GRANT OPTION"],
    },
    23: {
        "grading": "keyword",
        "keywords": ["REVOKE", "DELETE", "univDB.*", "FROM", "user1", "127.1.1.1"],
    },
    24: {
        "grading": "state",
        "setupDrop": "DROP VIEW IF EXISTS V1_고학년학생;",
        "checkSql": "SELECT * FROM V1_고학년학생 ORDER BY 학생이름;",
        "keywords": ["CREATE VIEW", "V1_고학년학생", "AS", "SELECT", "이름", "나이", "성별", "학년", "FROM", "학생"],
    },
    25: {
        "grading": "state",
        "setupDrop": "DROP VIEW IF EXISTS V2_과목수강현황;",
        "checkSql": "SELECT * FROM V2_과목수강현황 ORDER BY 과목번호;",
        "keywords": ["CREATE VIEW", "V2_과목수강현황", "AS", "SELECT", "과목번호", "강의실", "COUNT", "JOIN", "수강", "GROUP BY"],
    },
    26: {
        "grading": "keyword",
        "keywords": ["집계", "DISTINCT", "GROUP BY", "JOIN", "기본키"],
    },
    27: {
        "grading": "state",
        "checkSql": "SELECT name FROM pragma_index_list('수강') WHERE name = 'idx_수강';",
        "keywords": ["CREATE INDEX", "idx_수강", "ON", "수강", "학번", "과목번호"],
    },
    28: {
        "grading": "state",
        "checkSql": "SELECT name, [unique] FROM pragma_index_list('과목') WHERE name = 'idx_과목';",
        "keywords": ["CREATE UNIQUE INDEX", "idx_과목", "ON", "과목", "이름"],
    },
    29: {
        "grading": "keyword",
        "keywords": ["DROP INDEX", "idx_수강", "수강"],
    },
    30: {
        "grading": "keyword",
        "keywords": ["루트", "리프", "균형", "탐색"],
    },
    31: {
        "grading": "keyword",
        "keywords": ["18", "12", "6", "4", "바이트", "글자"],
    },
    32: {
        "grading": "keyword",
        "keywords": ["2", "-2", "34.5"],
    },
    33: {
        "grading": "keyword",
        "keywords": ["DATE_ADD", "2020-12-12", "INTERVAL", "42", "DAY", "DATEDIFF"],
    },
    34: {
        "grading": "keyword",
        "keywords": ["컴파일", "트래픽", "속도", "보안"],
    },
    35: {
        "grading": "keyword",
        "keywords": ["커서", "CURSOR"],
    },
    36: {
        "grading": "keyword",
        "keywords": ["CALL", "InsertOrUpdateCourse", "c006", "연극학개론", "DROP PROCEDURE"],
    },
    37: {
        "grading": "keyword",
        "keywords": ["자동", "INSERT", "UPDATE", "DELETE"],
    },
    38: {
        "grading": "keyword",
        "keywords": ["OLD", "NEW"],
    },
    39: {
        "grading": "keyword",
        "keywords": ["CREATE FUNCTION", "Fn_Grade", "RETURNS", "IF", "최우수", "우수", "보통", "RETURN"],
    },
    40: {
        "grading": "keyword",
        "keywords": ["CALL", "자동", "간접"],
    },
    41: {
        "grading": "keyword",
        "keywords": ["원자성", "일관성", "고립성", "지속성"],
    },
    42: {
        "grading": "keyword",
        "keywords": ["START TRANSACTION", "DELETE", "학생", "성별", "남", "ROLLBACK"],
    },
    43: {
        "grading": "keyword",
        "keywords": ["REDO", "UNDO", "COMMIT", "재실행", "취소"],
    },
    44: {
        "grading": "keyword",
        "keywords": ["읽기", "쓰기", "공유", "독점", "양립"],
    },
    45: {
        "grading": "keyword",
        "keywords": ["유령", "Phantom", "SERIALIZABLE"],
    },
}


def parse_subjective_questions():
    raw = SUBJ_FILE.read_text(encoding="utf-8")
    pattern = re.compile(
        r"### Q(\d+)\.\s*(.+?)\n"
        r"\*\s*\*\*단원\*\*:\s*(.+?)\n"
        r"\*\s*\*\*유형\*\*:\s*(.+?)\n"
        r"\*\s*\*\*문제\*\*:\s*(.+?)\n\n"
        r"```(?:sql|text)\n"
        r"-- 정답[^\n]*\n"
        r"(.+?)\n"
        r"```\n\n"
        r"\*\s*\*\*해설\*\*:\s*(.+?)(?=\n---|\Z)",
        re.DOTALL,
    )
    questions = []
    for m in pattern.finditer(raw):
        qnum = int(m.group(1))
        short_title = m.group(2).strip()
        sub_type_label = m.group(4).strip()
        prob_body = m.group(5).strip()
        ans_sql = m.group(6).strip()
        expl = m.group(7).strip()

        # Separate first line of prob_body vs multi-line bullet details if any
        lines = [ln.strip() for ln in prob_body.splitlines() if ln.strip()]
        if len(lines) == 1:
            q_title = lines[0]
            q_desc = ""
        else:
            q_title = f"[{short_title}] {lines[0]}"
            q_desc = "\n".join(lines[1:])

        if qnum <= 15:
            cat = "SQL 기초"
            cat_code = "CH05"
            idx = qnum
            qid = f"B-S-{idx:02d}"
        elif qnum <= 30:
            cat = "SQL 활용"
            cat_code = "CH06"
            idx = qnum - 15
            qid = f"U-S-{idx:02d}"
        else:
            cat = "SQL 응용"
            cat_code = "CH07"
            idx = qnum - 30
            qid = f"A-S-{idx:02d}"

        meta = SUBJ_GRADING_META.get(qnum, {"grading": "keyword", "keywords": []})
        questions.append({
            "id": qid,
            "no": qnum,
            "category": cat,
            "chapter": cat_code,
            "type": "sql",
            "subTypeLabel": sub_type_label,
            "timeLimit": 120,  # 주관식 2분 (120초)
            "points": 2,
            "shortTitle": short_title,
            "title": q_title,
            "description": q_desc,
            "answer": ans_sql,
            "explanation": expl,
            "grading": meta["grading"],
            "orderMatters": meta.get("orderMatters", False),
            "setupDrop": meta.get("setupDrop", ""),
            "checkSql": meta.get("checkSql", ""),
            "keywords": meta.get("keywords", []),
        })
    return questions


def verify_sqlite_execution(subj_questions):
    for q in subj_questions:
        if q["grading"] in ("result", "state"):
            conn = sqlite3.connect(":memory:")
            conn.executescript(SCHEMA_SQL)
            if q.get("setupDrop"):
                conn.executescript(q["setupDrop"])
            cur = conn.cursor()
            if q["grading"] == "result":
                cur.execute(q["answer"])
                rows = cur.fetchall()
                assert len(rows) > 0, f"Q{q['no']} returned 0 rows!"
            elif q["grading"] == "state":
                conn.executescript(q["answer"])
                cur.execute(q["checkSql"])
                rows = cur.fetchall()
                assert len(rows) > 0, f"Q{q['no']} state check returned 0 rows!"
            conn.close()
    print("All SQLite result/state questions verified successfully!")


def main():
    choice_qs = parse_choice_questions()
    subj_qs = parse_subjective_questions()
    print(f"Parsed choice: {len(choice_qs)}, subjective: {len(subj_qs)}")
    assert len(choice_qs) == 45, f"Expected 45 choice questions, got {len(choice_qs)}"
    assert len(subj_qs) == 45, f"Expected 45 subjective questions, got {len(subj_qs)}"

    verify_sqlite_execution(subj_qs)

    all_qs = choice_qs + subj_qs
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    JS_DIR.mkdir(parents=True, exist_ok=True)

    (OUT_DIR / "schema.sql").write_text(SCHEMA_SQL, encoding="utf-8")
    (OUT_DIR / "questions.json").write_text(
        json.dumps(all_qs, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Create browser-ready JS module with questions + schema (including public version and answer keys)
    js_content = (
        "// Auto-generated from C:\\Users\\tuesv\\Downloads\\SQL시험문제\n"
        "// Categories: SQL 기초 (CH05), SQL 활용 (CH06), SQL 응용 (CH07)\n"
        "// Types: choice (객관식 45문항, 60초) / sql (주관식 45문항, 120초)\n\n"
        f"window.SQL_EXAM_SCHEMA = {json.dumps(SCHEMA_SQL, ensure_ascii=False)};\n\n"
        f"window.SQL_EXAM_QUESTIONS = {json.dumps(all_qs, ensure_ascii=False, indent=2)};\n"
    )
    (JS_DIR / "questions-data.js").write_text(js_content, encoding="utf-8")
    print("Generated questions.json, schema.sql, and js/questions-data.js successfully!")


if __name__ == "__main__":
    main()

