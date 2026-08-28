import { useEffect, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import type { VoiceMessageReadModel } from "../types/api";

interface Props { readonly workspaceId:string; readonly companyId:number; readonly conversationId:string; readonly messageId:string; readonly revision:number; }
function aborted(error:unknown):boolean{return error instanceof DOMException&&error.name==="AbortError";}
function status(value:VoiceMessageReadModel):string{const state=value.direction==="inbound"?value.transcriptionState:value.deferredState;return state===null?"Voice unavailable":({pending:"Processing audio",completed:"Transcript ready",unsupported:"Audio unsupported",suppressed:"Voice processing suppressed",failed:"Voice delivery failed",processing:"Preparing voice reply",audio_ready:"Audio ready",fallback:"Sent as text",accepted:"Sent",delivered:"Delivered",read:"Read",uncertain:"Delivery uncertain"}as Record<string,string>)[state]??"Voice unavailable";}

export function VoiceMessage({workspaceId,companyId,conversationId,messageId,revision}:Props):React.JSX.Element{
  const [model,setModel]=useState<VoiceMessageReadModel|null>(null),[loading,setLoading]=useState(true),[unavailable,setUnavailable]=useState(false),[playbackError,setPlaybackError]=useState(false);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setUnavailable(false);setPlaybackError(false);setModel(null);void atlasApi.getVoiceMessage(workspaceId,companyId,conversationId,messageId,controller.signal).then(value=>{if(!controller.signal.aborted)setModel(value);}).catch(error=>{if(!controller.signal.aborted&&!aborted(error)){setUnavailable(true);if(!(error instanceof ApiError)||error.status!==404){} }}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[workspaceId,companyId,conversationId,messageId,revision]);
  if(loading)return <p className="conversation-voice" role="status">Loading voice status…</p>;
  if(unavailable||!model)return <p className="conversation-voice" role="status">Voice unavailable</p>;
  const playback=model.playbackAvailable&&!playbackError;
  return <section className="conversation-voice" aria-label={model.direction==="inbound"?"Voice message":"Voice reply"}><strong>{model.direction==="inbound"?"Audio message":"Voice reply"}</strong><span>{status(model)}</span>{model.transcript!==null&&<p className="conversation-voice__transcript">{model.transcript}</p>}{model.transcriptLanguageTag!==null&&model.transcript!==null&&<small>Language: {model.transcriptLanguageTag}</small>}{model.fallbackAvailable&&<small>Text fallback available</small>}{playback&&<audio controls preload="none" aria-label={model.direction==="inbound"?"Play audio message":"Play voice reply"} src={atlasApi.voicePlaybackUrl(workspaceId,companyId,conversationId,messageId)} onError={()=>setPlaybackError(true)} />}{model.playbackAvailable&&playbackError&&<p role="status">Audio unavailable</p>}</section>;
}
