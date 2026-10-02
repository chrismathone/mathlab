import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeacher, isResponse, badRequest } from '@/lib/api';
import { getExamScope } from '@/lib/demo/accounts';
import { examPaperCreateSchema, examPaperQuerySchema } from '@/lib/exam-analysis/schemas';
import { matchSchoolByName } from '@/lib/utils/school-matcher';
import { getExamAnalysisStuckMs } from '@/lib/exam-analysis/cli-llm';
import { readEnglishCommentaryState } from '@/lib/exam-analysis/english/commentary/schema';

/** GET /api/exam-analysis — 시험지 목록 조회 */
export async function GET(request: NextRequest) {
  const user = await requireTeacher();
  if (isResponse(user)) return user;

  const { searchParams } = new URL(request.url);
  const params = examPaperQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!params.success) return badRequest('잘못된 쿼리 파라미터입니다');

  const { page, limit, subject, grade, status, studentId, search } = params.data;
  const tenantWhere = await getExamScope(user);

  try {
    const where: Record<string, unknown> = {
      ...tenantWhere,
      ...(subject && { subject }),
      ...(grade && { grade }),
      ...(status && { status }),
      ...(studentId && { studentId }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { schoolName: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    // ANALYZING 이 라우트 타임아웃(+버퍼)보다 오래면 갇힌 것으로 보고 복구.
    // 로컬 CLI 는 10~22분이라 2분 컷이면 살아 있는 분석을 실패로 덮어쓴다.
    const stuckThreshold = new Date(Date.now() - getExamAnalysisStuckMs());
    await prisma.examPaper.updateMany({
      where: { ...tenantWhere, status: 'ANALYZING', updatedAt: { lt: stuckThreshold } },
      data: { status: 'FAILED', errorMessage: '분석이 시간 제한을 넘겨 중단되었습니다. 다시 실행해 주세요.' },
    });

    const [items, total] = await Promise.all([
      prisma.examPaper.findMany({
        where,
        include: {
          teacher: { select: { id: true, name: true } },
          student: { select: { id: true, name: true } },
          school: { select: { id: true, name: true, district: true } },
          analyses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true, totalQuestions: true, totalPoints: true, earnedPoints: true, analyzedAt: true, modelVersion: true,
              analyzedBy: true,
              analyzedByUser: { select: { id: true, name: true } },
              extensions: {
                select: {
                  agentType: true,
                  errorMessage: true,
                  lastRunBy: true,
                  lastRunAt: true,
                  lastRunByUser: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.examPaper.count({ where }),
    ]);

    // 학습 대책·분석글 등 다른 extension의 큰 JSON은 목록에서 읽지 않는다.
    // 현재 페이지의 총평만 검증하고 응답에는 작은 판정값을 싣는다.
    const analysisIds = items.flatMap(item => item.analyses.map(analysis => analysis.id));
    const commentaries = analysisIds.length ? await prisma.examAnalysisExtension.findMany({
      where: { analysisId: { in: analysisIds }, agentType: 'commentary' },
      select: { analysisId: true, result: true },
    }) : [];
    const commentaryByAnalysis = new Map(commentaries.map(row => [row.analysisId, row.result]));
    return NextResponse.json({
      data: items.map(item => ({ ...item, analyses: item.analyses.map(analysis => ({
        ...analysis,
        extensions: analysis.extensions.map(({ errorMessage, ...extension }) => {
          const result = extension.agentType === 'commentary' ? commentaryByAnalysis.get(analysis.id) : null;
          const legacy = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
          const english = item.subject === 'ENGLISH' ? readEnglishCommentaryState(result) : null;
          return {
            ...extension,
            commentaryReady: extension.agentType === 'commentary' && !errorMessage &&
              (english ? !!english.document && (!english.running || english.running.expired) :
                typeof legacy.overall_comment === 'string' && legacy.overall_comment.trim().length > 0),
          };
        }),
      })) })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[exam-analysis GET] 목록 조회 에러:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '시험지 목록을 불러오는 중 오류가 발생했습니다' } },
      { status: 500 },
    );
  }
}

/**
 * POST /api/exam-analysis — 시험지 레코드 생성
 *
 * 파일은 클라이언트가 사전에 /api/exam-analysis/signed-upload-urls로 발급받은
 * signed URL을 통해 Supabase Storage에 직접 업로드한 뒤, 그 publicUrl을 본 API에
 * 전달한다 (Vercel 본문 4.5MB 한계 우회).
 *
 * Request: JSON { fileUrls: string[], fileType: 'pdf' | 'image', ...metadata }
 */
export async function POST(request: NextRequest) {
  const user = await requireTeacher();
  if (isResponse(user)) return user;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return badRequest('요청 데이터를 읽을 수 없습니다');
  }

  const fileUrls = payload.fileUrls;
  if (!Array.isArray(fileUrls) || fileUrls.length === 0 || !fileUrls.every(u => typeof u === 'string' && u.length > 0)) {
    return badRequest('업로드된 파일 URL이 필요합니다');
  }

  const fileTypeRaw = payload.fileType;
  const fileType = fileTypeRaw === 'pdf' || fileTypeRaw === 'image' ? fileTypeRaw : 'pdf';

  const parsed = examPaperCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return badRequest('시험지 정보가 올바르지 않습니다', parsed.error.issues.map(i => ({
      field: i.path.join('.'),
      message: i.message,
    })));
  }

  try {
    // 학교 매칭: 프론트에서 선택한 schoolId 우선, 없으면 이름으로 자동 매칭
    const schoolName = parsed.data.schoolName || null;
    let schoolId: string | null = parsed.data.schoolId || null;
    if (!schoolId && schoolName) {
      try {
        schoolId = await matchSchoolByName(schoolName, parsed.data.grade);
      } catch {
        // 매칭 실패해도 시험지 생성은 계속 진행
      }
    }

    // examScope JSON에 연도/학기/종류 메타 포함 (단순 array 레거시 호환 유지)
    const hasScopeMeta =
      parsed.data.examYear != null ||
      parsed.data.examSemester != null ||
      parsed.data.examCategory != null ||
      !!parsed.data.textbookId;
    const scopeValue: unknown = hasScopeMeta
      ? {
          topics: parsed.data.examScope || [],
          examYear: parsed.data.examYear ?? null,
          examSemester: parsed.data.examSemester ?? null,
          examCategory: parsed.data.examCategory ?? null,
          ...(parsed.data.textbookId ? { textbookId: parsed.data.textbookId } : {}),
        }
      : (parsed.data.examScope || undefined);

    const examPaper = await prisma.examPaper.create({
      data: {
        tenantId: user.viewingTenantId ?? user.tenantId ?? '',
        teacherId: user.id,
        studentId: parsed.data.studentId || null,
        title: parsed.data.title,
        subject: parsed.data.subject as 'MATH' | 'ENGLISH',
        grade: parsed.data.grade,
        category: parsed.data.category || null,
        unit: parsed.data.unit || null,
        examScope: scopeValue as never,
        schoolName,
        schoolId,
        examType: parsed.data.examType,
        fileUrls: fileUrls.join(','),
        fileType,
      },
    });

    return NextResponse.json({ data: examPaper }, { status: 201 });
  } catch (error) {
    console.error('[exam-analysis POST] 시험지 생성 에러:', error);
    return NextResponse.json(
      { error: { code: 'CREATE_FAILED', message: '시험지 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요' } },
      { status: 500 },
    );
  }
}
