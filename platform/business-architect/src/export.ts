export function renderBusinessPlanMarkdown(artifact:any):string{
  const sections=artifact?.content?.sections??artifact?.sections??{};
  const lines=['# '+(artifact?.content?.title??artifact?.title??'Business Plan'),'',
    'Generated: '+(artifact?.content?.generatedAt??new Date().toISOString()),''];
  for(const [name,value] of Object.entries(sections)){
    lines.push('## '+name.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()),'');
    lines.push(typeof value==='string'?value:'~~~json\n'+JSON.stringify(value,null,2)+'\n~~~','');
  }
  return lines.join('\n');
}
export function renderArtifactJson(artifact:any):string{return JSON.stringify(artifact,null,2);}
