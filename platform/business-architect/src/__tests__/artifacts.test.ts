import { describe,expect,it } from 'vitest';
import { composeBusinessPlan,composeExecutiveSummary } from '../artifacts';
describe('artifact composers',()=>{
 it('keeps generated plans traceable to source project',()=>{const x=composeBusinessPlan({id:'p',name:'Test',evidenceRefs:['r1'],assumptions:['a']});expect(x.provenance.projectId).toBe('p');expect(x.provenance.evidenceRefs).toEqual(['r1']);});
 it('creates a structured executive summary',()=>{const x=composeExecutiveSummary({id:'p',name:'Test',summary:'S'});expect(x.title).toBe('Test');expect(x.summary).toBe('S');});
});
