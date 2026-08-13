import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Minus, NotePencil, Plus } from "@phosphor-icons/react";
import { Button, ErrorState, Skeleton } from "../ui";

export function PdfReader({ url, initialPage, totalPagesHint, onPageChange, onAddNote }: {
  url: string;
  initialPage: number;
  totalPagesHint?: number;
  onPageChange: (page: number) => void;
  onAddNote: (page: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(Math.max(1, initialPage || 1));
  const [totalPages, setTotalPages] = useState(Math.max(1, totalPagesHint || 1));
  const [scale, setScale] = useState(1.1);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (typeof HTMLCanvasElement !== "undefined" && !canvasRef.current?.getContext) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | undefined;
    setState("loading");
    void import("pdfjs-dist").then(async (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const document = await pdfjs.getDocument({ url }).promise;
      if (cancelled) return;
      setTotalPages(document.numPages);
      const safePage = Math.min(page, document.numPages);
      if (safePage !== page) setPage(safePage);
      const pdfPage = await document.getPage(safePage);
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      renderTask = pdfPage.render({ canvasContext: context, viewport, canvas });
      await renderTask.promise;
      if (!cancelled) setState("ready");
    }).catch((error) => { if (!cancelled && error?.name !== "RenderingCancelledException") { setMessage("PDF 无法打开，请确认文件完整。"); setState("error"); } });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [page, scale, url]);
  const move = (next: number) => { const value = Math.max(1, Math.min(totalPages, next)); if (value === page) return; setPage(value); onPageChange(value); };
  return <div className="pdf-reader">
    <div className="pdf-toolbar"><Button size="sm" variant="ghost" aria-label="上一页" disabled={page <= 1} onClick={() => move(page - 1)}><ArrowLeft size={16} />上一页</Button><label>第 <input aria-label="跳转页码" type="number" min="1" max={totalPages} value={page} onChange={(event) => move(Number(event.target.value))} /> / {totalPages} 页</label><Button size="sm" variant="ghost" aria-label="下一页" disabled={page >= totalPages} onClick={() => move(page + 1)}>下一页<ArrowRight size={16} /></Button><span className="pdf-zoom"><Button size="sm" variant="ghost" aria-label="缩小" onClick={() => setScale((value) => Math.max(.6, value - .2))}><Minus size={15} /></Button><b>{Math.round(scale * 100)}%</b><Button size="sm" variant="ghost" aria-label="放大" onClick={() => setScale((value) => Math.min(2.4, value + .2))}><Plus size={15} /></Button></span><Button size="sm" onClick={() => onAddNote(page)}><NotePencil size={15} />添加当前页笔记</Button></div>
    <div className="pdf-canvas-wrap">{state === "loading" ? <div className="pdf-loading"><Skeleton lines={5} /></div> : null}{state === "error" ? <ErrorState message={message} /> : null}<canvas ref={canvasRef} hidden={state === "error"} aria-label={`PDF 第 ${page} 页`} /></div>
  </div>;
}
