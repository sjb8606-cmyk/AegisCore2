import { HttpResearchProvider } from './research-provider';
import { saveFundingFinding } from './funding';

export async function searchFundingOpportunities(tenantId:string,projectId:string,query:string){
  const provider=new HttpResearchProvider();
  const results=await provider.search(query+' business grants funding eligibility deadline');
  const saved=[];
  for(const result of results){
    saved.push(await saveFundingFinding(tenantId,projectId,{
      title:result.sourceTitle,provider:'external research provider',url:result.sourceUrl,status:'unknown',
      evidenceRefs:[result.sourceUrl],notes:[result.text.slice(0,1000)],
    }));
  }
  return saved;
}
