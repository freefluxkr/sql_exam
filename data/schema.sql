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