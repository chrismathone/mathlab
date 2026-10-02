// 🚧 수학 랩실(Lab) 레이아웃 — 은닉 서브시스템 진입 게이트
//
// ⚠️ CLAUDE.md "최우선 하드 경계" 참조.
//   - (teacher) 레이아웃을 상속하지 않는 독립 세그먼트(/lab).
//   - 미인가 시 assertLabAccess()가 notFound()로 중단 → 일반 사용자에겐 404.
import { assertLabAccess } from '@/lib/lab/gate';

export const metadata = {
  title: 'Lab',
  robots: { index: false, follow: false },
};

export default async function LabLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 게이트: 킬스위치 off · 비로그인 · SUPER_ADMIN 아님 → notFound()
  await assertLabAccess();

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 overflow-y-auto">
      <header className="border-b border-slate-800 px-6 py-3 flex items-center gap-3">
        <span className="text-xs font-mono tracking-widest text-amber-400">🚧 LAB</span>
        <span className="text-sm text-slate-400">수학 랩실 자동화 — 내부 개발 (은닉)</span>
      </header>
      <main className="px-6 py-8 max-w-5xl mx-auto">{children}</main>
    </div>
  );
}
