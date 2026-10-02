// 🚧 Lab P0 — [DEV] 사람 채점 시뮬레이션 API (은닉, SUPER_ADMIN 전용)
//   POST { worksheetId, correctRate? } → 워크시트에 정/오 무작위 입력(채점지 대체).
//   합성 데이터로 루프를 닫기 위한 개발 보조. 실제 채점 UI/스캔으로 대체된다.
import { NextRequest, NextResponse } from 'next/server';
import { guardLabApi } from '@/lib/lab/gate';
import { simulateManualGrading } from '@/lib/lab/service';

export async function POST(req: NextRequest) {
  const gate = await guardLabApi();
  if (gate instanceof Response) return gate;

  try {
    const body = await req.json().catch(() => ({}));
    const worksheetId = typeof body?.worksheetId === 'string' ? body.worksheetId : undefined;
    const correctRate = typeof body?.correctRate === 'number' ? body.correctRate : 0.6;
    if (!worksheetId) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'worksheetId가 필요합니다' } },
        { status: 400 },
      );
    }
    const submission = await simulateManualGrading(worksheetId, correctRate);
    return NextResponse.json({ data: { submissionId: submission.id, items: submission.items.length } });
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: e instanceof Error ? e.message : '오류' } },
      { status: 500 },
    );
  }
}
