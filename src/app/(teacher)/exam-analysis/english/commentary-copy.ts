'use client';

import { hashStr, NAVER_CAPTURE_VERSION } from '@/lib/exam-analysis/naver-capture-sig';

export const ENGLISH_CAPTURE_VERSION = `${NAVER_CAPTURE_VERSION}-english-1`;
type Block = { url: string; summary: string };
const TTL = 3 * 24 * 60 * 60 * 1000;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 화면과 같은 스냅샷을 720px로 복제하여 캡처한다. 원래 지면과 선택 상태는 바꾸지 않는다. */
export async function copyEnglishCommentaryImages(input: {
  root: HTMLElement; examId: string; report: unknown; onProgress: (done: number, total: number) => void;
}) {
  const { root, examId, onProgress } = input;
  const signature = hashStr(JSON.stringify([ENGLISH_CAPTURE_VERSION, input.report, root.className, root.dataset.templateSignature]));
  const key = `mathlab_english_images_${examId}`;
  let blocks: Block[] = [];
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && typeof cached === 'object' && 'signature' in cached && cached.signature === signature &&
      'savedAt' in cached && typeof cached.savedAt === 'number' && Date.now() - cached.savedAt < TTL &&
      'blocks' in cached && Array.isArray(cached.blocks) && cached.blocks.length &&
      cached.blocks.every(b => b && typeof b.url === 'string' && /^https?:\/\//.test(b.url) && typeof b.summary === 'string')) {
      blocks = cached.blocks;
    }
  } catch { /* 저장된 캐시가 없으면 새로 캡처한다. */ }

  if (!blocks.length) {
    await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 3000))]);
    const shell = document.createElement('div');
    shell.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px;pointer-events:none;';
    shell.setAttribute('aria-hidden', 'true');
    const clone = root.cloneNode(true) as HTMLElement;
    clone.style.width = '720px';
    clone.style.maxWidth = 'none';
    shell.appendChild(clone);
    document.body.appendChild(shell);
    try {
      const { domToPng } = await import('modern-screenshot');
      const nodes = Array.from(clone.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.offsetHeight >= 24);
      if (!nodes.length) throw new Error('총평 본문을 펼친 뒤 다시 복사해 주세요.');
      for (const [index, node] of nodes.entries()) {
        onProgress(index, nodes.length);
        const dataUrl = await domToPng(node, { scale: 2, backgroundColor: getComputedStyle(clone).backgroundColor });
        const res = await fetch(`/api/exam-analysis/${examId}/upload-section-image`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: `en_${signature}_${index}`, dataUrl }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || typeof json?.data?.url !== 'string' || !/^https?:\/\//.test(json.data.url)) {
          throw new Error('총평 이미지를 모두 준비하지 못했습니다. 다시 복사해 주세요.');
        }
        blocks.push({ url: json.data.url, summary: node.dataset.blockSummary || '' });
      }
      onProgress(nodes.length, nodes.length);
      try { localStorage.setItem(key, JSON.stringify({ signature, savedAt: Date.now(), blocks })); } catch { /* 캐시 없이도 복사 가능 */ }
    } finally { shell.remove(); }
  }

  const html = `<div style="width:720px;max-width:100%">${blocks.map(b =>
    `<p style="margin:0"><img src="${escape(b.url)}" alt="${escape(b.summary)}" style="width:720px;max-width:100%" /></p>` +
    `<p style="color:#444;font-size:14px;line-height:1.75;margin:8px 0 24px">${escape(b.summary)}</p>`,
  ).join('')}</div>`;
  const plain = blocks.map(b => b.summary).filter(Boolean).join('\n\n');
  let copied = false;
  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
      copied = true;
    } catch { /* 브라우저의 대체 복사 경로 */ }
  }
  if (!copied) {
    const area = document.createElement('div');
    area.style.cssText = 'position:fixed;left:-10000px;top:0;';
    area.innerHTML = html;
    document.body.appendChild(area);
    const selection = window.getSelection();
    const prior = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    try {
      const range = document.createRange(); range.selectNodeContents(area);
      selection?.removeAllRanges(); selection?.addRange(range);
      copied = document.execCommand('copy');
    } finally {
      selection?.removeAllRanges(); if (prior) selection?.addRange(prior);
      area.remove();
    }
  }
  if (!copied) throw new Error('클립보드에 복사하지 못했습니다. 창을 클릭한 뒤 다시 시도해 주세요.');
  void fetch(`/api/exam-analysis/${examId}/article-copy`, { method: 'POST' }).catch(() => {});
  return blocks.length;
}
