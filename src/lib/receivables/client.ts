import { supabase } from "@/lib/supabaseClient";
import type { ReceivablesListResult } from "./types";

export interface ReceivableCommandError extends Error { code?:string; current?:unknown; status?:number; retryable:boolean }
type PendingCommand={command:Record<string,unknown>;createdAt:string};
type TerminalEvidence={command:Record<string,unknown>;code?:string;message:string;status?:number;resolvedAt:string};

async function session(){const {data}=await supabase.auth.getSession();if(!data.session?.access_token||!data.session.user.id)throw new Error("Sign in again to continue.");return {token:data.session.access_token,userId:data.session.user.id}}
export function receivablesOutboxKey(userId:string){return `zerodata:receivables-outbox:${userId}`}
function terminalKey(userId:string){return `zerodata:receivables-terminal:${userId}`}
function readJson<T>(key:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(key)??"") as T}catch{return fallback}}
function readOutbox(userId:string){return readJson<PendingCommand[]>(receivablesOutboxKey(userId),[])}
function writeOutbox(userId:string,items:PendingCommand[]){localStorage.setItem(receivablesOutboxKey(userId),JSON.stringify(items))}
function removeOperation(userId:string,operationId:string){writeOutbox(userId,readOutbox(userId).filter(item=>String(item.command.operation_id)!==operationId))}
function preserveTerminal(userId:string,command:Record<string,unknown>,error:ReceivableCommandError){const evidence=readJson<TerminalEvidence[]>(terminalKey(userId),[]);evidence.push({command,code:error.code,message:error.message,status:error.status,resolvedAt:new Date().toISOString()});localStorage.setItem(terminalKey(userId),JSON.stringify(evidence.slice(-20)))}

export function isRetryableReceivableFailure(status:number|undefined){return status===undefined||status>=500}

async function send(command:Record<string,unknown>,accessToken:string){
 let response:Response;try{response=await fetch("/api/receivables/commands",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify(command)})}catch(cause){const error=new Error("Connection lost before the financial result was known.",{cause}) as ReceivableCommandError;error.retryable=true;throw error}
 let result:Record<string,unknown>;try{result=await response.json() as Record<string,unknown>}catch(cause){const error=new Error("The server response could not be read; the exact command is retained.",{cause}) as ReceivableCommandError;error.status=response.status;error.retryable=true;throw error}
 if(!response.ok){const error=new Error(String(result.message??"The command was not confirmed.")) as ReceivableCommandError;error.code=typeof result.code==="string"?result.code:undefined;error.current=result.current;error.status=response.status;error.retryable=isRetryableReceivableFailure(response.status);throw error}
 return result;
}

async function token(){return (await session()).token}
export async function fetchReceivables(query=""):Promise<ReceivablesListResult>{const response=await fetch(`/api/receivables${query}`,{headers:{Authorization:`Bearer ${await token()}`},cache:"no-store"});const result=await response.json();if(!response.ok)throw new Error(result.message??"Payment Collections are unavailable.");return result}

export async function executeReceivableCommand(command:Record<string,unknown>){
 if(!navigator.onLine)throw new Error("An internet connection is required for financial actions.");const auth=await session(),operationId=String(command.operation_id??"");const existing=readOutbox(auth.userId);if(!existing.some(item=>String(item.command.operation_id)===operationId))writeOutbox(auth.userId,[...existing,{command,createdAt:new Date().toISOString()}]);
 try{const result=await send(command,auth.token);removeOperation(auth.userId,operationId);return result}catch(cause){const error=cause as ReceivableCommandError;if(!error.retryable){removeOperation(auth.userId,operationId);preserveTerminal(auth.userId,command,error)}throw error}
}

export async function recoverReceivableCommands(){
 if(!navigator.onLine)return {confirmed:0,pending:0,terminal:0};const auth=await session();let confirmed=0,terminal=0;
 for(const item of [...readOutbox(auth.userId)]){try{await send(item.command,auth.token);removeOperation(auth.userId,String(item.command.operation_id));confirmed++}catch(cause){const error=cause as ReceivableCommandError;if(!error.retryable){removeOperation(auth.userId,String(item.command.operation_id));preserveTerminal(auth.userId,item.command,error);terminal++}}}
 return {confirmed,pending:readOutbox(auth.userId).length,terminal};
}
