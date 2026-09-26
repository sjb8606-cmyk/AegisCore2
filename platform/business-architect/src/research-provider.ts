import { AppError, ErrorCode } from '@platform/utils';
import { RawResearchResult } from '@platform/research';

export interface ResearchProvider { search(query:string):Promise<RawResearchResult[]>; }

export class HttpResearchProvider implements ResearchProvider {
  constructor(private readonly endpoint=process.env.BUSINESS_ARCHITECT_RESEARCH_URL,private readonly apiKey=process.env.BUSINESS_ARCHITECT_RESEARCH_API_KEY){}
  async search(query:string):Promise<RawResearchResult[]>{
    if(!this.endpoint)throw new AppError('Business Architect research provider is not configured.',ErrorCode.NOT_IMPLEMENTED);
    const response=await fetch(this.endpoint,{method:'POST',headers:{'content-type':'application/json',...(this.apiKey?{'authorization':'Bearer '+this.apiKey}:{})},body:JSON.stringify({query})});
    if(!response.ok)throw new AppError('Business Architect research provider failed with HTTP '+response.status,ErrorCode.BAD_REQUEST);
    const payload:any=await response.json();
    if(!Array.isArray(payload.results))throw new AppError('Research provider returned no results array.',ErrorCode.UNPROCESSABLE);
    return payload.results.map((r:any)=>({sourceUrl:String(r.sourceUrl??r.url??''),sourceTitle:String(r.sourceTitle??r.title??''),text:String(r.text??r.content??'')})).filter((r:RawResearchResult)=>r.sourceUrl&&r.sourceTitle&&r.text);
  }
}
