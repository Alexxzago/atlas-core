import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { ConversationControlResponse, ConversationDelivery, ConversationDetail, ConversationInboxFilters, ConversationInboxItem, Permission } from "../types/api";
import { EmptyExperience } from "../design-system/product";
import { PageHeader } from "./AppShell";
import { buildConversationInboxViewModel, type ConversationState } from "./conversationInboxPresentation";
import { VoiceMessage } from "./VoiceMessage";

interface Props { readonly csrf: string; readonly workspaceId: string | null; readonly companyId: number | null; readonly capabilities: readonly Permission[]; }
const pollDelay = 3_000, maximumBackoff = 30_000, maximumPagesPerCycle = 20;

function aborted(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

export function ConversationInbox({ csrf, workspaceId, companyId, capabilities }: Props): React.JSX.Element {
  const { t, formatDate } = useI18n();
  const [items, setItems] = useState<Awaited<ReturnType<typeof atlasApi.listConversations>>["items"]>([]), [selected, setSelected] = useState<ConversationDetail | null>(null), [nextPageCursor,setNextPageCursor]=useState<string|null>(null);
  const [filters,setFilters]=useState<ConversationInboxFilters>({});
  const [listLoading, setListLoading] = useState(false), [moreLoading,setMoreLoading]=useState(false), [detailLoading, setDetailLoading] = useState(false), [working, setWorking] = useState(false), [sending, setSending] = useState(false), [listError, setListError] = useState(false), [detailError, setDetailError] = useState(false), [detailRefreshError, setDetailRefreshError] = useState(false), [mobileDetail, setMobileDetail] = useState(false), [content, setContent] = useState(""), [voiceRevisions,setVoiceRevisions]=useState<Record<string,number>>({}), [showJumpToLatest,setShowJumpToLatest]=useState(false);
  const listAbort = useRef<AbortController | null>(null), moreAbort=useRef<AbortController|null>(null), detailAbort = useRef<AbortController | null>(null), mutationAbort = useRef<AbortController | null>(null), feedAbort = useRef<AbortController | null>(null), feedTimer = useRef<number | null>(null), detailHeading = useRef<HTMLHeadingElement>(null), timeline = useRef<HTMLOListElement>(null), selectedId = useRef<string | null>(null), itemsRef=useRef<typeof items>([]), listRequestId = useRef(0), detailRequestId = useRef(0), operationIds = useRef(new Map<string, string>()), wasAtLatest = useRef(true), timelineIdentity = useRef<string | null>(null), mutationInFlight = useRef(false);
  const readable = capabilities.includes("company:read"), manageable = capabilities.includes("conversation:manage"), canSend = capabilities.includes("conversation:message:send"), controlsDisabled = working || detailLoading || listLoading;
  const viewItems = useMemo(() => buildConversationInboxViewModel(items), [items]); selectedId.current = selected?.conversationId ?? null; itemsRef.current=items;

  const loadDetail = useCallback(async (id: string, focus = false): Promise<boolean> => {
    if (!workspaceId || !companyId) return false;
    const hasLastGoodDetail = selectedId.current === id;
    if (focus) { timelineIdentity.current = null; wasAtLatest.current = true; setShowJumpToLatest(false); }
    detailAbort.current?.abort(); const controller = new AbortController(), requestId = ++detailRequestId.current; detailAbort.current = controller;
    setDetailLoading(true); setDetailError(false); setDetailRefreshError(false);
    try { const detail = await atlasApi.getConversation(workspaceId, companyId, id, controller.signal); if (requestId === detailRequestId.current && !controller.signal.aborted) { setSelected((current) => current?.conversationId === id ? mergeDetail(detail, current) : detail); if (focus) setMobileDetail(true); return true; } return false; }
    catch (cause) { if (requestId === detailRequestId.current && !aborted(cause)) { if (hasLastGoodDetail) setDetailRefreshError(true); else setDetailError(true); } return false; }
    finally { if (requestId === detailRequestId.current) setDetailLoading(false); }
  }, [workspaceId, companyId]);

  const load = useCallback(async (preserve = false): Promise<boolean> => {
    if (!workspaceId || !companyId || !readable) return false;
    listAbort.current?.abort(); const controller = new AbortController(), requestId = ++listRequestId.current; listAbort.current = controller;
    setListLoading(true); setListError(false);
    try {
      const response = await atlasApi.listConversations(workspaceId, companyId, filters, undefined, controller.signal);
      const inbox = response;
      if (requestId !== listRequestId.current || controller.signal.aborted) return false;
      const merged = mergeInboxItems(inbox.items, preserve ? itemsRef.current : itemsRef.current.filter((item) => item.conversationId === selectedId.current));
      const mapped = buildConversationInboxViewModel(merged); setItems(merged); if (!preserve) setNextPageCursor(inbox.nextCursor);
      const retained = selectedId.current && mapped.some((item) => item.id === selectedId.current) ? selectedId.current : null;
      if (retained) await loadDetail(retained); else setSelected(null);
      return true;
    } catch (cause) { if (requestId === listRequestId.current && !aborted(cause)) setListError(true); return false; }
    finally { if (requestId === listRequestId.current) setListLoading(false); }
  }, [workspaceId, companyId, readable, loadDetail, filters]);
  const loadMore = async (): Promise<void> => {
    if (!workspaceId || !companyId || !nextPageCursor || moreLoading) return;
    moreAbort.current?.abort(); const controller=new AbortController(); moreAbort.current=controller; setMoreLoading(true); setListError(false);
    try { const page=await atlasApi.listConversations(workspaceId,companyId,filters,nextPageCursor,controller.signal); if(!controller.signal.aborted){setItems(current=>mergeInboxItems([...current,...page.items.filter(item=>!current.some(existing=>existing.conversationId===item.conversationId))],current));setNextPageCursor(page.nextCursor);} }
    catch(error){if(!aborted(error))setListError(true);} finally {if(moreAbort.current===controller)setMoreLoading(false);}
  };

  useEffect(() => {
    if (!workspaceId || !companyId || !readable) return;
    let active = true, cursor: string | null = null, failures = 0, inFlight = false, resumePending = false;
    const clearTimer = (): void => { if (feedTimer.current !== null) { window.clearTimeout(feedTimer.current); feedTimer.current = null; } };
    const current = (): boolean => active && !feedAbort.current?.signal.aborted;
    const schedule = (delay: number, task: () => Promise<void>): void => { clearTimer(); if (!active || document.hidden) return; feedTimer.current = window.setTimeout(() => { feedTimer.current = null; void task(); }, delay); };
    const bootstrap = async (): Promise<void> => {
      if (!active || inFlight || document.hidden) return;
      inFlight = true; clearTimer(); feedAbort.current?.abort(); listAbort.current?.abort(); detailAbort.current?.abort(); const controller = new AbortController(); feedAbort.current = controller; cursor = null;
      try {
        const feed = await atlasApi.getConversationFeed(workspaceId, companyId, undefined, undefined, controller.signal);
        if (!current() || controller !== feedAbort.current || typeof feed.nextCursor !== "string" || !feed.nextCursor) throw new DOMException("Aborted", "AbortError");
        cursor = feed.nextCursor;
        await load();
        if (active && controller === feedAbort.current && !controller.signal.aborted) { failures = 0; schedule(pollDelay, poll); }
      } catch (error) {
        if (!aborted(error) && active && controller === feedAbort.current) { setListError(true); failures += 1; schedule(Math.min(pollDelay * 2 ** failures, maximumBackoff), bootstrap); }
      } finally { if (controller === feedAbort.current) { inFlight = false; if (resumePending && active && !document.hidden) { resumePending = false; void (cursor === null ? bootstrap() : poll()); } } }
    };
    const poll = async (): Promise<void> => {
      if (!active || inFlight || document.hidden || cursor === null) return;
      inFlight = true; clearTimer(); const controller = new AbortController(); feedAbort.current?.abort(); feedAbort.current = controller;
      try {
        let changed = false, pages = 0; const voiceMessages = new Set<string>();
        while (active && !controller.signal.aborted && cursor !== null && pages < maximumPagesPerCycle) {
          const feed = await atlasApi.getConversationFeed(workspaceId, companyId, cursor, undefined, controller.signal);
          if (!current() || controller !== feedAbort.current) return;
          if (feed.resyncRequired) { inFlight = false; await bootstrap(); return; }
          for(const event of feed.events){if(event.type==="voice_state_changed"&&event.conversationId===selectedId.current&&event.relatedMessageId)voiceMessages.add(event.relatedMessageId);else changed=true;} cursor = feed.nextCursor; pages += 1;
          if (!feed.hasMore) break;
        }
        if(voiceMessages.size>0)setVoiceRevisions(current=>{const next={...current};for(const id of voiceMessages)next[id]=(next[id]??0)+1;return next;});
        if (changed) await load(true);
        if (active && controller === feedAbort.current && !controller.signal.aborted) { failures = 0; schedule(pages === maximumPagesPerCycle ? 0 : pollDelay, poll); }
      } catch (error) {
        if (!aborted(error) && active && controller === feedAbort.current) { setListError(true); failures += 1; schedule(Math.min(pollDelay * 2 ** failures, maximumBackoff), poll); }
      } finally { if (controller === feedAbort.current) { inFlight = false; if (resumePending && active && !document.hidden) { resumePending = false; void (cursor === null ? bootstrap() : poll()); } } }
    };
    const visibility = (): void => { if (document.hidden) { clearTimer(); feedAbort.current?.abort(); return; } if (inFlight) { resumePending = true; feedAbort.current?.abort(); return; } if (cursor === null) void bootstrap(); else void poll(); };
    setItems([]); setNextPageCursor(null); setSelected(null); setVoiceRevisions({}); setMobileDetail(false); setContent(""); document.addEventListener("visibilitychange", visibility); void bootstrap();
    return () => { active = false; clearTimer(); feedAbort.current?.abort(); listAbort.current?.abort(); moreAbort.current?.abort(); detailAbort.current?.abort(); mutationAbort.current?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [workspaceId, companyId, readable, load]);

  useEffect(() => { if (mobileDetail && selected) detailHeading.current?.focus(); }, [mobileDetail, selected?.conversationId]);
  const scrollToLatest = (): void => { const element = timeline.current; if (!element) return; element.scrollTop = element.scrollHeight; wasAtLatest.current = true; setShowJumpToLatest(false); };
  const timelineKey = selected ? selected.messages.map((message) => message.messageId).join(":") : "";
  useLayoutEffect(() => { if (!selected || !timeline.current) return; const identity = `${selected.conversationId}:${timelineKey}`; if (timelineIdentity.current === identity) return; const changedConversation = timelineIdentity.current === null || !timelineIdentity.current.startsWith(`${selected.conversationId}:`); timelineIdentity.current = identity; if (changedConversation || wasAtLatest.current) scrollToLatest(); else setShowJumpToLatest(true); }, [selected?.conversationId, timelineKey]);
  const control = async (action: "take" | "release" | "resolve" | "resume"): Promise<boolean> => {
    if (!workspaceId || !companyId || !selected || controlsDisabled || mutationInFlight.current || ((action === "release" || action === "resolve") && !selected.controlledByCurrentActor) || (action === "resume" && selected.controlState !== "human_required")) return false;
    const key = `${action}:${selected.conversationId}:${selected.controlVersion}`, operationId = operationIds.current.get(key) ?? crypto.randomUUID(); operationIds.current.set(key, operationId);
    mutationInFlight.current = true; mutationAbort.current?.abort(); const controller = new AbortController(); mutationAbort.current = controller; setWorking(true); setDetailError(false);
    try {
      const response: ConversationControlResponse = action === "take" ? await atlasApi.takeOverConversation(csrf, workspaceId, companyId, selected.conversationId, selected.controlVersion, operationId, controller.signal) : action === "release" ? await atlasApi.releaseConversation(csrf, workspaceId, companyId, selected.conversationId, selected.controlVersion, operationId, controller.signal) : action === "resolve" ? await atlasApi.resolveConversation(csrf, workspaceId, companyId, selected.conversationId, selected.controlVersion, operationId, controller.signal) : await atlasApi.resumeConversation(csrf, workspaceId, companyId, selected.conversationId, selected.controlVersion, operationId, controller.signal);
      operationIds.current.delete(key); setItems((current) => current.map((item) => item.conversationId === selected.conversationId ? { ...item, ...response.control } : item)); setSelected((current) => current?.conversationId === selected.conversationId ? { ...current, ...response.control } : current); await loadDetail(selected.conversationId); return true;
    } catch (error) { if (!aborted(error)) { if (selectedId.current === selected.conversationId) setDetailRefreshError(true); else setDetailError(true); if (error instanceof ApiError && error.status === 409) await load(); } return false; }
    finally { if (mutationAbort.current === controller) setWorking(false); mutationInFlight.current = false; }
  };
  const send = async (): Promise<void> => {
    const submitted = content.trim(); if (!workspaceId || !companyId || !selected || !selected.controlledByCurrentActor || !submitted || controlsDisabled || mutationInFlight.current) return;
    mutationInFlight.current = true; mutationAbort.current?.abort(); const controller = new AbortController(); mutationAbort.current = controller; setSending(true); setDetailError(false);
    try { const result = await atlasApi.sendConversationMessage(csrf, workspaceId, companyId, selected.conversationId, submitted, crypto.randomUUID()); setContent(""); if (result.message) setSelected((current) => current?.conversationId === selected.conversationId && !current.messages.some((message) => message.messageId === result.message.messageId) ? { ...current, messages: [...current.messages, { ...result.message, senderRole: "operator", deliveryCategory: "sent", delivery: { state: result.delivery.state, updatedAt: result.message.createdAt, safeErrorCategory: null } }] } : current); scrollToLatest(); void loadDetail(selected.conversationId); }
    catch (error) { if (!aborted(error)) { if (selectedId.current === selected.conversationId) setDetailRefreshError(true); else setDetailError(true); } }
    finally { if (mutationAbort.current === controller) setSending(false); mutationInFlight.current = false; }
  };
  const select = async (id: string): Promise<void> => { if (selected && selected.conversationId !== id && selected.controlledByCurrentActor && !await control("release")) return; if (selectedId.current !== id) setContent(""); await loadDetail(id, true); if (workspaceId && companyId) { try { await atlasApi.markConversationRead(csrf,workspaceId,companyId,id); setItems(current=>current.map(item=>item.conversationId===id?{...item,unreadCount:0}:item)); setSelected(current=>current?.conversationId===id?{...current,unreadCount:0}:current); } catch { /* Reading must not prevent inspecting the conversation. */ } } };
  const leaveDetail = async (): Promise<void> => { if (selected?.controlledByCurrentActor && !await control("release")) return; setMobileDetail(false); };
  if (!workspaceId || !companyId) return <section><PageHeader title={t("conversation.title")} description={t("conversation.description")} /><EmptyExperience title={t("conversation.companyRequired")} description={t("conversation.companyRequiredDescription")} /></section>;
  if (!readable) return <section><PageHeader title={t("conversation.title")} description={t("conversation.description")} /><EmptyExperience title={t("conversation.unavailable")} description={t("conversation.unavailableDescription")} /></section>;
  return <section className={`conversation-workspace${mobileDetail ? " is-showing-detail" : ""}`} aria-busy={listLoading || working || sending}>
    <div className="conversation-workspace__anchor"><PageHeader title={t("conversation.title")} description={t("conversation.description")} /><button className="button button--quiet" type="button" onClick={() => void load()} disabled={listLoading || working}>{t("conversation.refresh")}</button></div><div className="conversation-filters"><label>{t("conversation.filterState")}<select value={filters.controlState??""} onChange={event=>setFilters(current=>({...current,controlState:event.target.value as ConversationInboxFilters["controlState"]||undefined}))}><option value="">{t("conversation.filterAll")}</option><option value="human_required">{t("conversation.state.attention")}</option><option value="human_controlled">{t("conversation.state.human")}</option><option value="automated">{t("conversation.state.automated")}</option></select></label><label>{t("conversation.filterConversationState")}<select value={filters.state??""} onChange={event=>setFilters(current=>({...current,state:event.target.value as ConversationInboxFilters["state"]||undefined}))}><option value="">{t("conversation.filterAll")}</option><option value="open">{t("conversation.filterOpen")}</option><option value="closed">{t("conversation.filterClosed")}</option></select></label><label>{t("conversation.filterChannel")}<select value={filters.channel??""} onChange={event=>setFilters(current=>({...current,channel:event.target.value as ConversationInboxFilters["channel"]||undefined}))}><option value="">{t("conversation.filterAll")}</option><option value="whatsapp">WhatsApp</option><option value="web_chat">{t("conversation.channel.web_chat")}</option></select></label><label><input type="checkbox" checked={filters.unreadOnly??false} onChange={event=>setFilters(current=>({...current,unreadOnly:event.target.checked||undefined}))}/>{t("conversation.filterUnread")}</label></div>
    {listError && <div className="inline-message inline-message--error" role="alert"><p>{t("conversation.unavailableDescription")}</p><button className="button button--secondary" onClick={() => void load()}>{t("common.retry")}</button></div>}
    {listLoading && items.length === 0 && <p role="status">{t("conversation.loading")}</p>}
    {!listLoading && !listError && items.length === 0 && <EmptyExperience title={t("conversation.empty")} description={t("conversation.emptyDescription")} />}
      {items.length > 0 && <div className="conversation-split"><aside className="conversation-list" aria-label={t("conversation.listLabel")}><ol>{viewItems.map((item) => <li key={item.id}><button type="button" className={selected?.conversationId === item.id ? "is-selected" : ""} aria-current={selected?.conversationId === item.id ? "true" : undefined} onClick={() => void select(item.id)}><span className="conversation-list__top"><strong>{item.identity ?? t("conversation.unnamed")}</strong>{item.lastActivityAt && <time dateTime={item.lastActivityAt}>{formatDate(item.lastActivityAt)}</time>}</span><span className="conversation-list__preview">{t(`conversation.channel.${item.channel}`)} · {item.preview ?? t("conversation.noMessages")}</span><span className="conversation-statuses"><span className={`conversation-state conversation-state--${item.state}`}>{responderLabel(item.state, item.controlledByCurrentActor, t)}{item.unreadCount>0&&<b className="conversation-unread">{item.unreadCount}</b>}</span>{item.attentionRequired&&<span className="conversation-attention">{t("conversation.attention")}</span>}</span></button></li>)}</ol>{nextPageCursor!==null&&<button className="button button--quiet conversation-list__more" type="button" onClick={()=>void loadMore()} disabled={moreLoading}>{moreLoading?t("conversation.loadingMore"):t("conversation.loadMore")}</button>}</aside>
      <main className="conversation-detail" aria-label={t("conversation.detailLabel")}>{mobileDetail && <button className="conversation-detail__back" type="button" onClick={() => void leaveDetail()}>← {t("conversation.backToList")}</button>}
        {!selected && !detailLoading && !detailError && <div className="conversation-detail__prompt"><h2>{t("conversation.selectTitle")}</h2><p>{t("conversation.selectDescription")}</p></div>}{detailLoading && !selected && <p role="status">{t("conversation.loadingDetail")}</p>}{detailError && <div className="inline-message inline-message--error" role="alert"><p>{t("conversation.detailUnavailable")}</p>{selectedId.current && <button className="button button--secondary" onClick={() => void loadDetail(selectedId.current!)}>{t("common.retry")}</button>}</div>}
        {selected && !detailError && <article aria-busy={detailLoading}><header className="conversation-detail__header"><h2 ref={detailHeading} tabIndex={-1}>{selected.contactLabel.trim() || t("conversation.unnamed")}</h2><p>{t(`conversation.channel.${selected.channel}`)}</p><div className="conversation-statuses"><span className={`conversation-state conversation-state--${selected.controlState === "human_controlled" ? "human" : "automated"}`}>{responderLabel(selected.controlState === "human_controlled" ? "human" : "automated", selected.controlledByCurrentActor, t)}</span>{selected.controlState === "human_required"&&<span className="conversation-attention">{t("conversation.attention")}</span>}</div></header>
          {detailRefreshError&&<div className="inline-message" role="status"><p>{t("conversation.refreshWarning")}</p><button className="button button--secondary" onClick={() => void loadDetail(selected.conversationId, true)}>{t("common.retry")}</button></div>}{selected.messages.length === 0 ? <div className="conversation-no-messages"><h3>{t("conversation.noMessagesTitle")}</h3><p>{t("conversation.noMessagesDescription")}</p></div> : <><ol ref={timeline} className="conversation-timeline" aria-label={t("conversation.messages")} onScroll={(event) => { const element = event.currentTarget; wasAtLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48; if (wasAtLatest.current) setShowJumpToLatest(false); }}>{[...selected.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((message) => { const delivery = message.deliveryCategory === "sent" ? message.delivery : null; return <li key={message.messageId} className={`conversation-message conversation-message--${message.deliveryCategory} conversation-message--${message.senderRole}`}><strong>{t(`conversation.sender.${message.senderRole}`)}</strong><p>{message.content}</p>{message.voiceAvailable&&<VoiceMessage workspaceId={workspaceId} companyId={companyId} conversationId={selected.conversationId} messageId={message.messageId} revision={voiceRevisions[message.messageId]??0}/>}<time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>{delivery && <div className={`conversation-delivery conversation-delivery--${delivery.state}`}><span>{t(deliveryLabel(delivery.state))}</span>{deliveryFailureLabel(delivery.safeErrorCategory) && <small>{t(deliveryFailureLabel(delivery.safeErrorCategory)!)}</small>}</div>}</li>; })}</ol>{showJumpToLatest&&<button className="button button--quiet conversation-jump" type="button" onClick={scrollToLatest}>{t("conversation.jumpLatest")}</button>}</>}
             <section className="conversation-control"><div><h3>{t("conversation.controlTitle")}</h3><p>{selected.controlState === "human_required" ? t("conversation.humanRequiredHelp") : selected.controlState === "human_controlled" ? t("conversation.releaseHelp") : t("conversation.takeHelp")}</p>{selected.controlState === "human_required" && <p>{t("conversation.humanRequiredAction")}</p>}</div>{manageable && selected.controlState !== "human_controlled" && <button className="button button--primary" disabled={controlsDisabled} onClick={() => void control("take")}>{t("conversation.take")}</button>}{manageable && selected.controlState === "human_controlled" && selected.controlledByCurrentActor && <div className="action-row"><button className="button button--primary" disabled={controlsDisabled} onClick={() => void control("resolve")}>{t("conversation.resolve")}</button><button className="button button--quiet" disabled={controlsDisabled} onClick={() => void control("release")}>{t("conversation.release")}</button></div>}</section>
            {canSend && selected.channel === "whatsapp" && selected.controlState === "human_controlled" && selected.controlledByCurrentActor && <form className="conversation-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><label className="form-field"><span>{t("conversation.reply")}</span><textarea required maxLength={10000} value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} disabled={sending} /></label><button className="button button--primary" disabled={sending || !content.trim()}>{sending ? t("conversation.sending") : t("conversation.send")}</button></form>}{selected.channel === "web_chat" && selected.controlState === "human_controlled" && selected.controlledByCurrentActor && <p className="inline-message">{t("conversation.webChatReplyUnavailable")}</p>}
        </article>}
      </main></div>}
  </section>;
}
function authority(item: ConversationInboxItem): Pick<ConversationInboxItem, "controlState" | "controlledByCurrentActor" | "attentionReason" | "takenAt" | "releasedAt" | "lastOperatorActivityAt" | "resolvedAt" | "controlVersion" | "updatedAt"> { const { controlState, controlledByCurrentActor, attentionReason, takenAt, releasedAt, lastOperatorActivityAt, resolvedAt, controlVersion, updatedAt } = item; return { controlState, controlledByCurrentActor, attentionReason, takenAt, releasedAt, lastOperatorActivityAt, resolvedAt, controlVersion, updatedAt }; }
function mergeInboxItems(incoming: readonly ConversationInboxItem[], current: readonly ConversationInboxItem[]): ConversationInboxItem[] { const currentById = new Map(current.map((item) => [item.conversationId, item])); return incoming.map((item) => { const known = currentById.get(item.conversationId); return known && known.controlVersion >= item.controlVersion ? { ...item, ...authority(known) } : item; }); }
function mergeDetail(detail: ConversationDetail, current: ConversationDetail): ConversationDetail { const messages = [...detail.messages, ...current.messages.filter((message) => !detail.messages.some((fresh) => fresh.messageId === message.messageId))]; return current.controlVersion >= detail.controlVersion ? { ...detail, ...authority(current), messages } : { ...detail, messages }; }
function responderLabel(state: ConversationState, controlledByCurrentActor: boolean, t: ReturnType<typeof useI18n>["t"]): string { return state === "human" ? t(controlledByCurrentActor ? "conversation.responder.you" : "conversation.responder.human") : state === "empty" || state === "unknown" ? t(`conversation.state.${state}`) : t("conversation.responder.atlas"); }
function formatTimestamp(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function deliveryLabel(state: ConversationDelivery["state"]): Parameters<ReturnType<typeof useI18n>["t"]>[0] { return `conversation.delivery.${state === "accepted" ? "sent" : state === "delivered" ? "delivered" : state === "read" ? "read" : state === "permanent_failure" || state === "uncertain" ? "failed" : "pending"}` as Parameters<ReturnType<typeof useI18n>["t"]>[0]; }
function deliveryFailureLabel(category: string | null): Parameters<ReturnType<typeof useI18n>["t"]>[0] | null { return category === "credentials_invalid" || category === "provider_rejected" || category === "rate_limited" || category === "provider_unavailable" ? `conversation.delivery.failure.${category}` as Parameters<ReturnType<typeof useI18n>["t"]>[0] : null; }
