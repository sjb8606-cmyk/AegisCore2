export function composeLaunchRoadmap(input:any){
  const actions=[
    {priority:1,action:'Validate highest-risk customer and market assumptions',dependsOn:['CUSTOMER_PROBLEM','RESEARCH']},
    {priority:2,action:'Finalize operating workflow and required resources',dependsOn:['OPERATIONS']},
    {priority:3,action:'Confirm pricing, costs, and break-even model',dependsOn:['PRICING','COSTS','FINANCIALS']},
    {priority:4,action:'Resolve high-impact risks and funding gaps',dependsOn:['RISKS','FUNDING']},
    {priority:5,action:'Execute first launch milestone and measure results',dependsOn:['PLAN']},
  ];
  return {title:input.name,generatedAt:new Date().toISOString(),actions,blockers:input.blockers??[],milestones:input.milestones??[]};
}
