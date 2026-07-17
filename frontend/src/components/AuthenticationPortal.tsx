import { useEffect, useReducer, useRef, useState } from "react";
import { ApiError, atlasApi, setAuthenticationRecovery } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { SessionBootstrapResponse } from "../types/api";
import { authenticationReducer } from "../state/authenticationState";
import { AuthenticatedCompanyPortal } from "./AuthenticatedCompanyPortal";

type View = "login" | "request" | "check" | "enroll" | "invitation" | "password";
type ChannelMessage={type:"csrf-rotated";csrfToken:string;csrfGeneration:number}|{type:"logout"}|{type:"session-invalidated"};
let bootstrapFlight:Promise<SessionBootstrapResponse>|null=null;
function bootstrapSingleFlight():Promise<SessionBootstrapResponse>{
  if(!bootstrapFlight)bootstrapFlight=atlasApi.bootstrapSession().finally(()=>{bootstrapFlight=null;});
  return bootstrapFlight;
}

export function AuthenticationPortal(): React.JSX.Element {
  const { locale } = useI18n();
  const es = locale === "es";
  const invitationLink = location.pathname.includes("accept-invitation");
  const hasProof = new URLSearchParams(location.search).has("proof");
  const [view,setView]=useState<View>(hasProof&&!invitationLink?"enroll":"login");
  const [auth,dispatch]=useReducer(authenticationReducer,{status:"booting"});
  const [email,setEmail]=useState("");const[password,setPassword]=useState("");const[confirmation,setConfirmation]=useState("");const[error,setError]=useState("");
  const epoch=useRef(0);const channel=useRef<BroadcastChannel|null>(null);
  const proof=():string=>new URLSearchParams(location.search).get("proof")??"";
  const message=():string=>es?"No pudimos completar la operación.":"We couldn't complete the operation.";
  const publish=(value:ChannelMessage):void=>channel.current?.postMessage(value);
  const applyBootstrap=(result:SessionBootstrapResponse,currentEpoch:number):boolean=>{
    if(epoch.current!==currentEpoch)return false;
    dispatch({type:"authenticated",result});if(invitationLink)setView("invitation");publish({type:"csrf-rotated",csrfToken:result.csrfToken,csrfGeneration:result.csrfGeneration});return true;
  };
  const bootstrap=async(retryConflict=true):Promise<boolean>=>{
    const currentEpoch=epoch.current;
    try{return applyBootstrap(await bootstrapSingleFlight(),currentEpoch);}
    catch(cause:unknown){
      if(epoch.current!==currentEpoch)return false;
      if(cause instanceof ApiError&&cause.status===409&&retryConflict){return bootstrap(false);}
      if(cause instanceof ApiError&&(cause.status===401||cause.status===403)){dispatch({type:"unauthenticated",...(cause.status===403?{error:message()}:{})});return false;}
      dispatch({type:"retryable",error:message()});return false;
    }
  };
  const invalidate=(broadcast:boolean):void=>{epoch.current+=1;dispatch({type:"unauthenticated"});setView("login");if(broadcast)publish({type:"session-invalidated"});};
  const submit=async(action:()=>Promise<void>):Promise<void>=>{setError("");try{await action();}catch{setError(message());}};

  useEffect(()=>{
    if(typeof BroadcastChannel!=="undefined"){
      const instance=new BroadcastChannel("atlas-auth");channel.current=instance;
      instance.onmessage=(event:MessageEvent<ChannelMessage>)=>{const value=event.data;if(value.type==="csrf-rotated")dispatch({type:"token",csrfToken:value.csrfToken,csrfGeneration:value.csrfGeneration});else invalidate(false);};
    }
    return()=>{channel.current?.close();channel.current=null;};
  },[]);
  useEffect(()=>{
    if(hasProof&&!invitationLink){dispatch({type:"unauthenticated"});return;}
    let active=true;const start=():void=>{if(active&&document.visibilityState==="visible")void bootstrap();};
    if(document.visibilityState==="visible")start();else document.addEventListener("visibilitychange",start,{once:true});
    return()=>{active=false;document.removeEventListener("visibilitychange",start);};
  },[]);
  useEffect(()=>{
    setAuthenticationRecovery(async(method:string)=>{const recovered=await bootstrap();if(!recovered&&method!=="GET"&&method!=="HEAD")publish({type:"session-invalidated"});return recovered;});
    return()=>setAuthenticationRecovery(null);
  });

  if(auth.status==="booting")return <main className="auth-card"><p role="status">{es?"Restaurando sesión…":"Restoring session…"}</p></main>;
  if(auth.status==="retryable-error")return <main className="auth-card"><p role="alert">{auth.error}</p><button onClick={()=>{dispatch({type:"boot"});void bootstrap();}}>{es?"Reintentar":"Retry"}</button></main>;
  if(auth.status==="authenticated"){
    if(view==="password")return <AuthForm title={es?"Cambiar contraseña":"Replace password"} error={error} onSubmit={event=>{event.preventDefault();void submit(async()=>{await atlasApi.replacePassword(auth.csrfToken,String(new FormData(event.currentTarget).get("current")??""),password,confirmation);epoch.current+=1;publish({type:"session-invalidated"});dispatch({type:"unauthenticated"});setView("login");});}}><Password name="current" label={es?"Contraseña actual":"Current password"}/><Password value={password} onChange={setPassword} label={es?"Nueva contraseña":"New password"}/><Password value={confirmation} onChange={setConfirmation} label={es?"Confirmación":"Confirmation"}/><button>{es?"Cambiar contraseña":"Replace password"}</button></AuthForm>;
    if(invitationLink&&view==="invitation")return <main className="auth-card"><h1>{es?"Invitación al espacio":"Workspace invitation"}</h1><button onClick={()=>void submit(async()=>{await atlasApi.acceptInvitation(auth.csrfToken,proof());history.replaceState({},"","/");setView("login");})}>{es?"Aceptar":"Accept"}</button><button onClick={()=>void submit(async()=>{await atlasApi.rejectInvitation(auth.csrfToken,proof());history.replaceState({},"","/");setView("login");})}>{es?"Rechazar":"Reject"}</button>{error&&<p role="alert">{error}</p>}</main>;
    return <AuthenticatedCompanyPortal csrf={auth.csrfToken} email={auth.identity.email} onPassword={()=>setView("password")} onLogout={()=>void submit(async()=>{epoch.current+=1;await atlasApi.logout(auth.csrfToken);publish({type:"logout"});dispatch({type:"unauthenticated"});setView("login");})}/>;
  }
  if(view==="check")return <main className="auth-card"><h1>{es?"Revisá tu correo":"Check your email"}</h1><p>{es?"Si la identidad es elegible, enviamos un enlace.":"If the identity is eligible, we sent a link."}</p><button onClick={()=>setView("login")}>{es?"Volver":"Back"}</button></main>;
  if(view==="enroll")return <AuthForm title={es?"Crear contraseña":"Create password"} error={error} onSubmit={event=>{event.preventDefault();void submit(async()=>{await atlasApi.completeCredentialEnrollment(proof(),password,confirmation);history.replaceState({},"","/");setView("login");});}}><Password value={password} onChange={setPassword} label={es?"Contraseña":"Password"}/><Password value={confirmation} onChange={setConfirmation} label={es?"Confirmación":"Confirmation"}/><button>{es?"Crear contraseña":"Create password"}</button></AuthForm>;
  if(view==="request")return <AuthForm title={es?"Inscribir una contraseña":"Enroll a password"} error={error} onSubmit={event=>{event.preventDefault();void submit(async()=>{await atlasApi.requestCredentialEnrollment(email);setView("check");});}}><label>{es?"Correo electrónico":"Email"}<input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></label><button>{es?"Enviar enlace":"Send link"}</button></AuthForm>;
  return <AuthForm title={es?"Iniciar sesión":"Log in"} error={error||auth.error||""} onSubmit={event=>{event.preventDefault();void submit(async()=>{const login=await atlasApi.login(email,password);const identity=await atlasApi.currentIdentity();const result:SessionBootstrapResponse={status:"authenticated",identity,csrfToken:login.csrfToken,csrfGeneration:login.csrfGeneration};dispatch({type:"authenticated",result});publish({type:"csrf-rotated",csrfToken:login.csrfToken,csrfGeneration:login.csrfGeneration});if(invitationLink)setView("invitation");});}}><label>{es?"Correo electrónico":"Email"}<input type="email" autoComplete="username" required value={email} onChange={event=>setEmail(event.target.value)}/></label><Password value={password} onChange={setPassword} label={es?"Contraseña":"Password"}/><button>{es?"Ingresar":"Log in"}</button><button type="button" onClick={()=>setView("request")}>{es?"Crear contraseña":"Enroll password"}</button></AuthForm>;
}

function AuthForm({title,error,onSubmit,children}:{title:string;error:string;onSubmit:React.FormEventHandler<HTMLFormElement>;children:React.ReactNode}):React.JSX.Element{return <main className="auth-card"><form onSubmit={onSubmit}><h1>{title}</h1>{error&&<p role="alert">{error}</p>}{children}</form></main>;}
function Password({label,name="password",value,onChange}:{label:string;name?:string;value?:string;onChange?:(value:string)=>void}):React.JSX.Element{return <label>{label}<input name={name} type="password" autoComplete={name==="current"?"current-password":"new-password"} required value={value} onChange={onChange?event=>onChange(event.target.value):undefined}/></label>;}
