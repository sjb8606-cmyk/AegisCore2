import { describe,expect,it } from 'vitest';
import { BusinessProjectSchema,ProjectCreateSchema,CONFIDENCE_TAGS } from '../schemas';
describe('Business Architect schemas',()=>{
 it('requires the evidence taxonomy',()=>expect(CONFIDENCE_TAGS).toEqual(['known','evidence_supported','estimated','assumption','unknown']));
 it('defaults new projects to draft',()=>expect(ProjectCreateSchema.parse({name:'x'}).status).toBe('draft'));
 it('rejects malformed project identifiers',()=>expect(()=>BusinessProjectSchema.parse({id:'bad'})).toThrow());
});
