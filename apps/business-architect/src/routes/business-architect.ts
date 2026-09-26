import { Router, NextFunction } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole, ROLES } from '../../../../platform/auth/src/index';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import {
 createBusinessProject,listBusinessProjects,getBusinessProject,updateBusinessProject,advanceStage,revisitStage,
 addCompetitor,listCompetitors,updateCompetitor,getBusinessModel,saveBusinessModel,getOperations,saveOperations,
 calculateTargetPrice,calculatePricingWithPlatformRules,savePricing,getCosts,saveCosts,ingestResearch,getResearch,getUnverifiedResearch,
 calculateFinancials,calculateFinancialSensitivity,buildBusinessRiskRegister,runRedTeamPass,finalizeRiskRegister,
 saveFundingFinding,listFundingFindings,generateBusinessPlanArtifact,generateExecutiveSummaryArtifact,listArtifacts
} from '../../../../platform/business-architect/src/index';

const router=Router(), useAuth=requireRole(ROLES.VIEWER);
const projectParam=z.object({id:z.string().uuid()});
const context=(req:AuthenticatedRequest)=>({tenantId:req.auth!.tenantId,actorId:req.auth!.sub});
const wrap=(fn:any)=>(req:any,res:any,next:NextFunction)=>Promise.resolve(fn(req,res)).catch(next);

router.get('/projects',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>res.json(await listBusinessProjects(req.auth!.tenantId))));
router.post('/projects',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const c=context(req);res.status(201).json(await createBusinessProject(c.tenantId,c.actorId,req.body));}));
router.get('/projects/:id',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await getBusinessProject(req.auth!.tenantId,p.id));}));
router.patch('/projects/:id',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),c=context(req);res.json(await updateBusinessProject(c.tenantId,c.actorId,p.id,req.body));}));

router.get('/projects/:id/stage',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),x=await getBusinessProject(req.auth!.tenantId,p.id);res.json({stage:x.currentStage,status:x.status});}));
router.post('/projects/:id/stage/advance',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),c=context(req);res.json(await advanceStage(c.tenantId,c.actorId,p.id,req.body));}));
router.post('/projects/:id/stage/revisit',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),c=context(req),stage=z.string().parse(req.body.stage);res.json(await revisitStage(c.tenantId,c.actorId,p.id,stage as any));}));

router.get('/projects/:id/competition',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await listCompetitors(req.auth!.tenantId,p.id));}));
router.post('/projects/:id/competition',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.status(201).json(await addCompetitor(req.auth!.tenantId,p.id,req.body));}));
router.patch('/projects/:id/competition/:competitorId',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await updateCompetitor(req.auth!.tenantId,p.id,p.competitorId,req.body));}));

router.get('/projects/:id/business-model',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await getBusinessModel(req.auth!.tenantId,p.id));}));
router.put('/projects/:id/business-model',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await saveBusinessModel(req.auth!.tenantId,p.id,req.body));}));
router.get('/projects/:id/operations',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await getOperations(req.auth!.tenantId,p.id));}));
router.put('/projects/:id/operations',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await saveOperations(req.auth!.tenantId,p.id,req.body));}));

router.get('/projects/:id/pricing',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),x=await getBusinessProject(req.auth!.tenantId,p.id);res.json(x.pricing);}));
router.post('/projects/:id/pricing/calculate',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>res.json(calculateTargetPrice(req.body))));
router.post('/projects/:id/pricing/calculate-with-rules',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await calculatePricingWithPlatformRules(req.auth!.tenantId,p.id,req.body));}));
router.put('/projects/:id/pricing',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await savePricing(req.auth!.tenantId,p.id,req.body));}));

router.get('/projects/:id/costs',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await getCosts(req.auth!.tenantId,p.id));}));
router.put('/projects/:id/costs',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await saveCosts(req.auth!.tenantId,p.id,req.body));}));

router.post('/projects/:id/research',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),c=context(req);
 const input=z.object({stage:z.string(),query:z.string().min(1),rawResults:z.array(z.object({sourceUrl:z.string(),sourceTitle:z.string(),text:z.string()}))}).parse(req.body);
 res.status(201).json(await ingestResearch(c.tenantId,c.actorId,p.id,input.stage,input.query,input.rawResults));}));
router.post('/projects/:id/research/search',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),c=context(req);const input=z.object({stage:z.string(),query:z.string().min(1)}).parse(req.body);const provider=new BA.HttpResearchProvider();const raw=await provider.search(input.query);res.status(201).json(await BA.ingestResearch(c.tenantId,c.actorId,p.id,input.stage,input.query,raw));}));
router.get('/projects/:id/research',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await getResearch(req.auth!.tenantId,p.id,String(req.query.stage||'RESEARCH')));}));
router.get('/projects/:id/research/unverified',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await getUnverifiedResearch(req.auth!.tenantId,p.id));}));

router.post('/projects/:id/financials/calculate',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),c=context(req);
 const result=await calculateFinancials(c.tenantId,c.actorId,p.id,req.body);await updateBusinessProject(c.tenantId,c.actorId,p.id,{financialModelRef:result.modelId});res.json(result);}));
router.post('/projects/:id/financials/sensitivity',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),c=context(req);res.json(await calculateFinancialSensitivity(c.tenantId,c.actorId,p.id,req.body));}));
router.get('/projects/:id/financials',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),x=await getBusinessProject(req.auth!.tenantId,p.id);
 if(!x.financialModelRef)return res.json(null);
 const rows=await withTenantQuery('SELECT * FROM financial_models WHERE id=$1 AND tenant_id=$2',[x.financialModelRef,req.auth!.tenantId],req.auth!.tenantId);res.json(rows[0]??null);}));

router.get('/projects/:id/risks',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);const rows=await withTenantQuery('SELECT * FROM risks WHERE register_id IN (SELECT id FROM risk_registers WHERE project_id=$1 AND tenant_id=$2) AND tenant_id=$2 ORDER BY created_at DESC',[p.id,req.auth!.tenantId],req.auth!.tenantId);res.json(rows);}));
router.post('/projects/:id/risks',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),c=context(req);res.status(201).json(await buildBusinessRiskRegister(c.tenantId,c.actorId,p.id,req.body));}));
router.post('/projects/:id/risks/red-team',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const c=context(req);res.json(await runRedTeamPass(c.tenantId,c.actorId,req.body));}));
router.post('/projects/:id/risks/finalize',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const c=context(req);res.json(await finalizeRiskRegister(c.tenantId,c.actorId,{registerId:z.string().uuid().parse(req.body.registerId)}));}));

router.post('/projects/:id/funding',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.status(201).json(await saveFundingFinding(req.auth!.tenantId,p.id,req.body));}));
router.get('/projects/:id/funding',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await listFundingFindings(req.auth!.tenantId,p.id));}));

router.post('/projects/:id/artifacts/plan',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),c=context(req);res.status(201).json(await generateBusinessPlanArtifact(c.tenantId,c.actorId,p.id));}));
router.post('/projects/:id/artifacts/executive-summary',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params),c=context(req);res.status(201).json(await generateExecutiveSummaryArtifact(c.tenantId,c.actorId,p.id));}));
router.get('/projects/:id/artifacts',useAuth,wrap(async(req:AuthenticatedRequest,res:any)=>{const p=projectParam.parse(req.params);res.json(await listArtifacts(req.auth!.tenantId,p.id));}));

export { router as businessArchitectRouter };
