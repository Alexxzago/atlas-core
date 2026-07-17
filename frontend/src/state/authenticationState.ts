import type { Identity, SessionBootstrapResponse } from "../types/api";

export type AuthenticationState =
  | { status:"booting" }
  | { status:"unauthenticated";error?:string }
  | { status:"authenticated";identity:Identity;csrfToken:string;csrfGeneration:number }
  | { status:"retryable-error";error:string };

export type AuthenticationAction =
  | {type:"boot"}
  | {type:"authenticated";result:SessionBootstrapResponse}
  | {type:"token";csrfToken:string;csrfGeneration:number}
  | {type:"unauthenticated";error?:string}
  | {type:"retryable";error:string};

export function authenticationReducer(state:AuthenticationState,action:AuthenticationAction):AuthenticationState{
  if(action.type==="boot")return{status:"booting"};
  if(action.type==="authenticated")return{status:"authenticated",identity:action.result.identity,csrfToken:action.result.csrfToken,csrfGeneration:action.result.csrfGeneration};
  if(action.type==="token")return state.status==="authenticated"&&action.csrfGeneration>state.csrfGeneration?{...state,csrfToken:action.csrfToken,csrfGeneration:action.csrfGeneration}:state;
  if(action.type==="unauthenticated")return{status:"unauthenticated",...(action.error?{error:action.error}:{})};
  return{status:"retryable-error",error:action.error};
}
