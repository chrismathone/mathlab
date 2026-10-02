// 🚧 수학 랩실(Lab) — P0 상태 코크핏 (정적, DB 미접근 → 마이그레이션 전 안전)
//
// 척추(StudentLearningState)와 5단계 파이프라인의 현재 모드/빌드 진행을 보여준다.
// DB 연동 뷰(학생/처방/채점)는 lab_* 테이블 마이그레이션 후 추가.

const STAGES = [
  { key: '진단', io: '채점결과 → masteryMap (BKT)', mode: 'MANUAL', auto: 'P2' },
  { key: '처방', io: 'mastery + 진도 → prescription', mode: 'MANUAL', auto: 'P3 (핵심 해자)' },
  { key: '공급', io: 'prescription → 시험지(HWP)', mode: 'MANUAL', auto: '반자동' },
  { key: '채점', io: '시험지 + 답안 → 문항별 정오', mode: 'MANUAL', auto: 'P1 / P5' },
  { key: '보고', io: 'mastery delta → 리포트', mode: 'MANUAL', auto: 'P4' },
];

const ROADMAP = [
  { id: 'P0', label: '척추 + dumb 처방(진도표만) + 공급 + 채점', done: false, active: true },
  { id: 'P1', label: '채점 auto (객관식·단답)', done: false, active: false },
  { id: 'P2', label: '진단 auto (누적 채점이 공짜로 켬)', done: false, active: false },
  { id: 'P3', label: '처방 smart화 (약점맵 반영)', done: false, active: false },
  { id: 'P4', label: '보고 auto', done: false, active: false },
  { id: 'P5', label: '서술형 채점 auto (VEHME)', done: false, active: false },
];

function ModeBadge({ mode }: { mode: string }) {
  const cls =
    mode === 'AUTO'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : mode === 'ASSISTED'
        ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
        : 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  return (
    <span className={`text-[11px] font-mono px-2 py-0.5 rounded-sm border ${cls}`}>{mode}</span>
  );
}

export default function LabHome() {
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold text-white">P0 — 척추 가동</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          모든 단계는 척추(<code className="text-amber-300">StudentLearningState</code>)에 대한 순수
          함수다. 산출물마다 <code className="text-amber-300">genMode</code>가 박혀 있어 단계별로
          사람↔자동을 독립 플립한다. 데이터는 역방향으로 흐른다 — 채점→진단→처방→공급.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-mono tracking-wider text-slate-500 mb-3">5단계 파이프라인</h2>
        <div className="overflow-hidden rounded-sm border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="text-left px-4 py-2 font-medium">단계</th>
                <th className="text-left px-4 py-2 font-medium">인터페이스</th>
                <th className="text-left px-4 py-2 font-medium">모드</th>
                <th className="text-left px-4 py-2 font-medium">자동화</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {STAGES.map((s) => (
                <tr key={s.key} className="hover:bg-slate-900/50">
                  <td className="px-4 py-2.5 font-medium text-white">{s.key}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{s.io}</td>
                  <td className="px-4 py-2.5">
                    <ModeBadge mode={s.mode} />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{s.auto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-mono tracking-wider text-slate-500 mb-3">빌드 로드맵</h2>
        <ol className="space-y-2">
          {ROADMAP.map((p) => (
            <li
              key={p.id}
              className={`flex items-center gap-3 rounded-sm border px-4 py-2.5 ${
                p.active
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-slate-800 bg-slate-900/30'
              }`}
            >
              <span
                className={`text-xs font-mono font-semibold ${
                  p.active ? 'text-amber-300' : 'text-slate-500'
                }`}
              >
                {p.id}
              </span>
              <span className={`text-sm ${p.active ? 'text-white' : 'text-slate-400'}`}>
                {p.label}
              </span>
              {p.active && (
                <span className="ml-auto text-[11px] font-mono text-amber-400">진행 중</span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-sm border border-slate-800 bg-slate-900/30 px-4 py-3">
        <p className="text-xs text-slate-500 leading-relaxed">
          ⏳ 다음: <code className="text-slate-300">lab_*</code> 테이블 마이그레이션(사용자 확인 후) →
          소규모 합성 개념 그래프 시드 → P0 루프(처방→공급→채점→진단) end-to-end 가동. HWP 출제
          엔진·84개월 진도표 JSON 확보 전까지 합성 데이터로 루프 검증.
        </p>
      </section>
    </div>
  );
}
