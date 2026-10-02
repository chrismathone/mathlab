// 🚧 수학 랩실(Lab) 접근 게이트 — 은닉(dark launch)
//
// ⚠️ CLAUDE.md "최우선 하드 경계" 참조.
//   - 일반 사용자에겐 /lab 이 "존재하지 않는 페이지"여야 한다 → notFound() (404).
//   - 리다이렉트 금지(흔적 남김). 404라야 원래 없는 페이지처럼 보인다.
//   - 킬스위치 LAB_ENABLED(기본 off) → off면 SUPER_ADMIN도 404.

import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

/** 환경변수 킬스위치. 'true'/'1'/'on' 일 때만 활성. 기본 off. */
export function isLabEnabled(): boolean {
  const v = (process.env.LAB_ENABLED ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on';
}

export type LabUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * 서버 컴포넌트(페이지/레이아웃)용 게이트.
 * 미인가(킬스위치 off · 비로그인 · SUPER_ADMIN 아님) 시 notFound()로 즉시 중단.
 * 인가 시 현재 사용자 반환.
 */
export async function assertLabAccess(): Promise<LabUser> {
  if (!isLabEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user || user.role !== 'SUPER_ADMIN') notFound();
  return user;
}

/**
 * API 라우트용 가드. 미인가면 404 Response 반환(인가 정보 비노출).
 * 사용: const gate = await guardLabApi(); if (gate instanceof Response) return gate;
 */
export async function guardLabApi(): Promise<LabUser | Response> {
  const notFoundRes = new Response(null, { status: 404 });
  if (!isLabEnabled()) return notFoundRes;
  const user = await getCurrentUser();
  if (!user || user.role !== 'SUPER_ADMIN') return notFoundRes;
  return user;
}
