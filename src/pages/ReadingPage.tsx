import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, BookOpen, CalendarPlus, FilePdf, NotePencil, PencilSimple, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { formatDate, formatDuration, localDate } from "../utils";
import { Badge, Button, EmptyState, EntityForm, ErrorState, Modal, PageHeader, Section, Skeleton, type FieldDefinition } from "../components/ui";
import { ModuleArtwork } from "../components/ModuleArtwork";
import type { Entity } from "../types";
import { PdfReader } from "../components/reading/PdfReader";

const statuses = { wishlist: "想读", reading: "在读", completed: "读完", paused: "暂停" } as const;
const bookFields: FieldDefinition[] = [
  { name: "title", label: "书名", required: true }, { name: "author", label: "作者" },
  { name: "status", label: "阅读状态", type: "select", required: true, options: Object.entries(statuses).map(([value, label]) => ({ value, label })) },
  { name: "total_pages", label: "总页数", type: "number" }, { name: "current_page", label: "当前页", type: "number" },
  { name: "rating", label: "评分（0—10）", type: "number", step: "0.5" }, { name: "description", label: "简介与备注", type: "textarea" },
];

export function ReadingPage() {
  const { bookId } = useParams();
  const { data, loading, error, run } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState("all");
  const [dialog, setDialog] = useState<{ type: string; item?: Entity; page?: number } | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);
  useEffect(() => { if (searchParams.get("new") === "book") setDialog({ type: "book" }); }, [searchParams]);
  const close = () => { setDialog(null); if (searchParams.has("new")) { searchParams.delete("new"); setSearchParams(searchParams, { replace: true }); } };
  if (loading) return <Skeleton lines={8} />;
  if (error) return <ErrorState message={error} />;
  const book = bookId ? data.books.find((item) => item.id === bookId) : null;
  if (bookId) return book ? <BookDetail book={book} data={data} run={run} back={() => navigate("/reading")} dialog={dialog} setDialog={setDialog} readingOpen={readingOpen} setReadingOpen={setReadingOpen} /> : <ErrorState message="没有找到这本书" />;
  const visible = filter === "all" ? data.books : data.books.filter((item) => item.status === filter);
  return <>
    <PageHeader icon={<ModuleArtwork module="reading" />} eyebrow="阅读与思考" title="读书" description="管理正在读的书，记录每一次进度、感受与思考。" actions={<Button onClick={() => setDialog({ type: "book" })}><Plus size={17} />添加书籍</Button>} />
    <div className="reading-summary">{Object.entries(statuses).map(([value, label]) => <button key={value} onClick={() => setFilter(value)}><strong>{data.books.filter((item) => item.status === value).length}</strong><span>{label}</span></button>)}<button onClick={() => setFilter("all")}><strong>{data.readingNotes.length}</strong><span>阅读笔记</span></button></div>
    <Section title="我的书架" description="按阅读状态筛选和继续阅读" action={<div className="reading-filters"><Button size="sm" variant={filter === "all" ? "primary" : "ghost"} onClick={() => setFilter("all")}>全部</Button>{Object.entries(statuses).map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? "primary" : "ghost"} onClick={() => setFilter(value)}>{label}</Button>)}</div>}>
      {visible.length ? <div className="book-grid">{visible.map((item) => <BookCard key={item.id} book={item} notes={data.readingNotes.filter((note) => note.book_id === item.id)} open={() => navigate(`/reading/${item.id}`)} />)}</div> : <EmptyState title="书架还是空的" description="添加第一本想读或正在读的书。" action={<Button variant="secondary" onClick={() => setDialog({ type: "book" })}>添加书籍</Button>} />}
    </Section>
    <BookDialog dialog={dialog} close={close} run={run} />
  </>;
}

function BookCard({ book, notes, open }: { book: Entity; notes: Entity[]; open: () => void }) {
  const completion = book.total_pages ? Math.round((Number(book.current_page || 0) / Number(book.total_pages)) * 100) : null;
  return <button className="book-card" onClick={open}><div className="book-cover">{book.cover_file_id ? <img src={`/api/books/${book.id}/cover`} alt={`${book.title}封面`} /> : <BookOpen size={38} />}<Badge tone={book.status === "completed" ? "success" : book.status === "reading" ? "accent" : "neutral"}>{statuses[book.status as keyof typeof statuses] ?? "想读"}</Badge></div><div className="book-card-copy"><span>{book.author || "作者未填写"}</span><h2>{book.title}</h2><div className="reading-progress"><i style={{ width: `${completion ?? 0}%` }} /></div><strong>{completion === null ? `读到第 ${book.current_page || 0} 页` : `${completion}%`}</strong><small>{`${notes.length} 篇笔记${book.last_read_at ? ` · 最近 ${formatDate(book.last_read_at)}` : ""}`}</small></div></button>;
}

function BookDetail({ book, data, run, back, dialog, setDialog, readingOpen, setReadingOpen }: any) {
  const sessions = data.readingSessions.filter((item: Entity) => item.book_id === book.id);
  const notes = data.readingNotes.filter((item: Entity) => item.book_id === book.id);
  const completion = book.total_pages ? Math.round((Number(book.current_page || 0) / Number(book.total_pages)) * 100) : null;
  const pagesRead = sessions.reduce((sum: number, item: Entity) => sum + Math.max(0, Number(item.end_page) - Number(item.start_page) + 1), 0);
  const minutes = sessions.reduce((sum: number, item: Entity) => sum + Number(item.duration_minutes || 0), 0);
  const fileInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const upload = async (file?: File) => {
    if (!file) return;
    try { await run(() => api.uploadBookPdf(book.id, file)); }
    finally { if (fileInput.current) fileInput.current.value = ""; }
  };
  const uploadCover = async (file?: File) => {
    if (!file) return;
    try { await run(() => api.uploadBookCover(book.id, file)); }
    finally { if (coverInput.current) coverInput.current.value = ""; }
  };
  return <>
    <PageHeader icon={<ModuleArtwork module="reading" />} eyebrow={book.author || "作者未填写"} title={book.title} description={book.description || "记录阅读进度，并把感受沉淀为自己的思考。"} actions={<><Button variant="ghost" onClick={back}><ArrowLeft size={16} />返回书架</Button><Button variant="secondary" onClick={() => coverInput.current?.click()}><UploadSimple size={16} />上传封面</Button><input ref={coverInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadCover(event.target.files?.[0])} /><Button variant="secondary" onClick={() => setDialog({ type: "book", item: book })}><PencilSimple size={16} />编辑资料</Button><Button variant="ghost" onClick={() => void run(() => api.remove("books", book.id)).then(back)}><Trash size={16} />删除书籍</Button></>} />
    <div className="reading-stats"><article><strong>{completion === null ? "—" : `${completion}%`}</strong><span>完成进度</span></article><article><strong>{pagesRead}</strong><span>累计阅读页</span></article><article><strong>{formatDuration(minutes)}</strong><span>累计时长</span></article><article><strong>{notes.length}</strong><span>笔记数量</span></article></div>
    <div className="reading-detail-grid"><Section title="阅读与 PDF" description={book.pdf_filename || "PDF 可选，纸质书也能记录"}><div className="pdf-entry"><FilePdf size={34} /><div><strong>{book.pdf_filename || "尚未上传 PDF"}</strong><p>{book.pdf_file_id ? "可在工作台中打开并继续阅读" : "支持最大 100 MB 的 PDF 文件"}</p></div>{book.pdf_file_id ? <Button onClick={() => setReadingOpen(true)}><BookOpen size={16} />打开阅读</Button> : <Button variant="secondary" onClick={() => fileInput.current?.click()}><UploadSimple size={16} />上传 PDF</Button>}<input ref={fileInput} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => void upload(event.target.files?.[0])} /></div><div className="detail-actions"><Button onClick={() => setDialog({ type: "progress", item: book })}><BookOpen size={16} />记录进度</Button><Button variant="secondary" onClick={() => setDialog({ type: "note", item: book, page: Number(book.current_page || 0) })}><NotePencil size={16} />添加笔记</Button><Button variant="ghost" onClick={() => void run(() => api.create("planItems", { title: `阅读：《${book.title}》`, plan_date: localDate(), source_module: "reading", source_entity_type: "book", source_entity_id: book.id, priority: "medium" }))}><CalendarPlus size={16} />安排阅读</Button></div></Section>
    <Section title="阅读历史" description="每一次推进都会保留记录">{sessions.length ? <div className="reading-history">{sessions.map((item: Entity) => <article key={item.id}><strong>{item.start_page}—{item.end_page} 页</strong><span>{formatDate(item.session_date)} · {formatDuration(item.duration_minutes)}</span><p>{item.notes || "没有补充备注"}</p></article>)}</div> : <p className="quiet-line">还没有阅读进度。</p>}</Section></div>
    <Section title="阅读笔记" description="摘录、感受和深入思考" action={<Button size="sm" onClick={() => setDialog({ type: "note", item: book, page: Number(book.current_page || 0) })}><Plus size={15} />添加笔记</Button>}>{notes.length ? <div className="reading-notes">{notes.map((note: Entity) => <article key={note.id}><header><div><strong>{note.chapter || "未命名章节"}</strong><span>{note.start_page != null ? `第 ${note.start_page}${note.end_page !== note.start_page ? `—${note.end_page}` : ""} 页` : formatDate(note.note_date)}</span></div><span><Button size="sm" variant="ghost" onClick={() => setDialog({ type: "note", item: book, note, page: note.start_page })}>编辑</Button><Button size="sm" variant="ghost" onClick={() => void run(() => api.remove("readingNotes", note.id))}>删除</Button></span></header>{note.excerpt ? <blockquote>{note.excerpt}</blockquote> : null}{note.feeling ? <p><b>感受</b>{note.feeling}</p> : null}{note.thinking ? <p><b>思考</b>{note.thinking}</p> : null}</article>)}</div> : <EmptyState title="还没有阅读笔记" description="从当前页记录一段摘录、感受或思考。" />}</Section>
    <BookDialog dialog={dialog} close={() => setDialog(null)} run={run} />
    {readingOpen ? <Modal open title={`阅读《${book.title}》`} description="翻页位置会保留，点击记录进度时写入阅读历史。" onClose={() => setReadingOpen(false)} wide><PdfReader url={`/api/books/${book.id}/pdf`} initialPage={Math.max(1, Number(book.current_page || 1))} totalPagesHint={Number(book.total_pages || 1)} onPageChange={(page) => void run(() => api.update("books", book.id, { current_page: page }))} onAddNote={(page) => { setReadingOpen(false); setDialog({ type: "note", item: book, page }); }} /></Modal> : null}
  </>;
}

function BookDialog({ dialog, close, run }: any) {
  if (!dialog) return null;
  if (dialog.type === "book") return <Modal open title={dialog.item ? "编辑书籍" : "添加书籍"} description="PDF 可以稍后在书籍详情中上传。" onClose={close}><EntityForm fields={bookFields} initial={{ status: "wishlist", current_page: 0, ...dialog.item }} onCancel={close} onSubmit={async (values) => { if (dialog.item) await run(() => api.update("books", dialog.item.id, values)); else await run(() => api.create("books", values)); close(); }} /></Modal>;
  if (dialog.type === "progress") { const nextPage = Number(dialog.item.current_page || 0) + 1; return <Modal open title="记录阅读进度" description={`当前读到第 ${dialog.item.current_page || 0} 页`} onClose={close}><EntityForm fields={[{ name: "session_date", label: "阅读日期", type: "date", required: true }, { name: "start_page", label: "起始页", type: "number", required: true }, { name: "end_page", label: "结束页", type: "number", required: true }, { name: "duration_minutes", label: "阅读分钟", type: "number" }, { name: "notes", label: "进度备注", type: "textarea" }]} initial={{ session_date: localDate(), start_page: nextPage, end_page: nextPage, duration_minutes: 0 }} onCancel={close} onSubmit={async (values) => { await run(() => api.recordReadingProgress(dialog.item.id, values)); close(); }} /></Modal>; }
  if (dialog.type === "note") return <Modal open title={dialog.note ? "编辑阅读笔记" : "添加阅读笔记"} description="页码会关联到这本书。" onClose={close} wide><EntityForm fields={[{ name: "note_date", label: "记录日期", type: "date", required: true }, { name: "chapter", label: "章节" }, { name: "start_page", label: "起始页", type: "number" }, { name: "end_page", label: "结束页", type: "number" }, { name: "excerpt", label: "原文摘录", type: "textarea" }, { name: "feeling", label: "读书感受", type: "textarea" }, { name: "thinking", label: "深入思考", type: "textarea" }]} initial={{ note_date: localDate(), start_page: dialog.page, end_page: dialog.page, ...dialog.note }} onCancel={close} onSubmit={async (values) => { const payload = { ...values, book_id: dialog.item.id }; if (dialog.note) await run(() => api.update("readingNotes", dialog.note.id, payload)); else await run(() => api.create("readingNotes", payload)); close(); }} /></Modal>;
  return null;
}
