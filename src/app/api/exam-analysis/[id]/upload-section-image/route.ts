import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeacher, isResponse, badRequest, notFound } from '@/lib/api';
import { assertDemoFeature, getExamScope } from '@/lib/demo/accounts';
import { getSupabase } from '@/lib/supabase';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/exam-analysis/[id]/upload-section-image
 * 클라이언트가 modern-screenshot로 캡처한 V3 섹션 PNG(dataURL)를 Supabase 'uploads'(공개)에 업로드 → 공개 URL 반환.
 *
 * 네이버 블로그는 외부 이미지 URL을 fetch해 재호스팅하므로, localhost에서도 인터넷-공개 Supabase URL이면 동작.
 * (앱 자체 엔드포인트는 localhost를 네이버가 못 가져옴 → Supabase 사용)
 *
 * body: { section: string, dataUrl: "data:image/png;base64,..." }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireTeacher();
  if (isResponse(user)) return user;
  const { id } = await params;

  const tenantWhere = await getExamScope(user);
  const examPaper = await prisma.examPaper.findFirst({ where: { id, ...tenantWhere }, select: { id: true } });
  if (!examPaper) return notFound('시험지를 찾을 수 없습니다');
  const demoGate = await assertDemoFeature(user, 'blog');
  if (demoGate.response) return demoGate.response;

  let body: { section?: string; dataUrl?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest('잘못된 요청 본문');
  }
  const section = (body.section || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  const dataUrl = body.dataUrl || '';
  if (!section || !dataUrl.startsWith('data:image/png;base64,')) {
    return badRequest('section / dataUrl(PNG)이 필요합니다');
  }

  const base64 = dataUrl.slice('data:image/png;base64,'.length);
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0 || buffer.length > 8_000_000) {
    return badRequest('이미지 크기가 올바르지 않습니다 (0 또는 8MB 초과)');
  }

  try {
    const client = getSupabase();
    const path = `naver-sections/${id}/${section}.png`;
    const { error } = await client.storage.from('uploads').upload(path, buffer, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) {
      console.error('[upload-section-image] Supabase 업로드 실패:', error.message);
      return NextResponse.json({ error: { code: 'UPLOAD_FAILED', message: '이미지 업로드 실패' } }, { status: 500 });
    }
    const { data } = client.storage.from('uploads').getPublicUrl(path);
    // 캐시 우회용 버전 쿼리 (재캡처 시 네이버가 새 이미지 fetch)
    const url = `${data.publicUrl}?t=${buffer.length}`;
    return NextResponse.json({ data: { url } });
  } catch (e) {
    console.error('[upload-section-image] 오류:', e);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: '업로드 중 오류' } }, { status: 500 });
  }
}
