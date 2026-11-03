# 🗄️ SQL Master 실전 역량 평가 시스템 (Ch05 기초 · Ch06 활용 · Ch07 응용)

객관식 45문항 + 주관식(SQL 작성) 45문항 = **총 90문항**으로 구성된 SQL 실전 역량 평가 및 관리자 통계 웹서비스입니다.

## 🔗 바로가기 (GitHub Pages)
- **👩‍🎓 응시자 시험 화면**: [https://freefluxkr.github.io/sql_exam/](https://freefluxkr.github.io/sql_exam/)
- **🧑‍💼 관리자 채점·통계 콘솔**: [https://freefluxkr.github.io/sql_exam/admin.html](https://freefluxkr.github.io/sql_exam/admin.html)

## ✨ 주요 기능
1. **3대 단원 × 객관식/주관식 맞춤형 응시**
   - `SQL 기초 (Ch05)` · `SQL 활용 (Ch06)` · `SQL 응용 (Ch07)`
   - 객관식(1문항 1분) / 주관식(1문항 2분) 시간 제한 및 초과 시 자동 제출·이동
   - 이전 문제 이동 금지, 응시자별 문제 랜덤 셔플, 시험 종료 후 결과 화면에서만 정답·해설 공개
2. **주관식 SQL 자동 채점 엔진 (`sql.js` WebAssembly + 하이브리드 루브릭)**
   - 브라우저 내장 SQLite 엔진에서 응시자 쿼리와 정답 쿼리를 실제 실행하여 결과표 비교
   - 관리자 화면에서 부분 점수 및 수동 점수 확정 지원
3. **관리자 6대 통계 지표 대시보드**
   - 평균 · 최고 · 최저 · 합격률(80점 이상) KPI 요약
   - 점수 분포 히스토그램 & 영역별 득점률 차트 (Chart.js)
   - 응시자별 순위표, 90문항별 정답률 분석, 엑셀(CSV) 원클릭 다운로드
