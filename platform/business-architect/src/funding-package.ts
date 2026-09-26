import { composeExecutiveSummary } from './artifacts';
export function composeFundingPackage(input:any){
  return {title:input.name,generatedAt:new Date().toISOString(),
    executiveSummary:composeExecutiveSummary(input),fundingNeed:input.fundingNeed??null,
    financialModel:input.financials??null,risks:input.risks??[],evidenceRefs:input.evidenceRefs??[],
    eligibilityFindings:input.eligibilityFindings??[],assumptions:input.assumptions??[]};
}
