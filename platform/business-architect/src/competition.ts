import { randomUUID } from 'crypto';
import { withTenantQuery } from '@platform/tenancy';
import { Competitor, CompetitorSchema } from './schemas';

export async function listCompetitors(tenantId:string,projectId:string):Promise<Competitor[]>{
  const rows=await withTenantQuery('SELECT * FROM business_competitors WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at',[tenantId,projectId],tenantId);
  return rows.map(mapCompetitor);
}
function mapCompetitor(row:any):Competitor{return CompetitorSchema.parse({
  id:row.id,projectId:row.project_id,tenantId:row.tenant_id,name:row.name,website:row.website,
  description:row.description,offerings:row.offerings??[],pricing:row.pricing??{},
  strengths:row.strengths??[],weaknesses:row.weaknesses??[],differentiation:row.differentiation??[],
  evidenceRefs:row.evidence_refs??[],confidenceTag:row.confidence_tag,
});}
export async function addCompetitor(tenantId:string,projectId:string,input:Omit<Competitor,'id'|'projectId'|'tenantId'>){
  const data=CompetitorSchema.omit({id:true,projectId:true,tenantId:true}).parse(input), id=randomUUID();
  const rows=await withTenantQuery(
    'INSERT INTO business_competitors (id,tenant_id,project_id,name,website,description,offerings,pricing,strengths,weaknesses,differentiation,evidence_refs,confidence_tag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
    [id,tenantId,projectId,data.name,data.website??null,data.description,JSON.stringify(data.offerings),JSON.stringify(data.pricing),JSON.stringify(data.strengths),JSON.stringify(data.weaknesses),JSON.stringify(data.differentiation),JSON.stringify(data.evidenceRefs),data.confidenceTag],
    tenantId);
  return mapCompetitor(rows[0]);
}
export async function updateCompetitor(tenantId:string,projectId:string,id:string,input:Partial<Omit<Competitor,'id'|'projectId'|'tenantId'>>){
  const data=CompetitorSchema.omit({id:true,projectId:true,tenantId:true}).partial().parse(input);
  const allowed:Record<string,string>={name:'name',website:'website',description:'description',offerings:'offerings',pricing:'pricing',strengths:'strengths',weaknesses:'weaknesses',differentiation:'differentiation',evidenceRefs:'evidence_refs',confidenceTag:'confidence_tag'};
  const sets:string[]=[],vals:any[]=[];let i=1;
  for(const [k,v] of Object.entries(data)){const c=allowed[k];if(!c)continue;sets.push(c+'=$'+i);vals.push(typeof v==='object'?JSON.stringify(v):v);i++;}
  if(!sets.length)return listCompetitors(tenantId,projectId).then(x=>x.find(c=>c.id===id));
  vals.push(id,projectId,tenantId);
  const rows=await withTenantQuery('UPDATE business_competitors SET '+sets.join(', ')+',updated_at=now() WHERE id=$'+i+' AND project_id=$'+(i+1)+' AND tenant_id=$'+(i+2)+' RETURNING *',vals,tenantId);
  return rows[0]?mapCompetitor(rows[0]):undefined;
}
