// 🚧 Lab P0 — 사이클 구동 API (은닉, SUPER_ADMIN 전용)
//   POST { studentId } → 한 사이클(채점→진단→처방→공급) 실행, 다음 시험지 반환.
import { NextRequest, NextResponse } from 'next/server';
import { guardLabApi } from '@/lib/lab/gate';
import { runStudentCycle } from '@/lib/lab/service';

export async function POST(req: NextRequest) {
  const gate = await guardLabApi();
  if (gate instanceof Response) return gate;

  try {
    const body = await req.json().catch(() => ({}));
    const studentId = typeof body?.studentId === 'string' ? body.studentId : undefined;
    if (!studentId) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'studentId가 필요합니다' } },
        { status: 400 },
      );
    }
    const worksheet = await runStudentCycle(studentId);
    return NextResponse.json({ data: worksheet });
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: e instanceof Error ? e.message : '오류' } },
      { status: 500 },
    );
  }
}
