import { readFileSync } from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../components/d5o/platform/job-finance-model.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function("require","module","exports",js)((name)=>{
  if(name==="./deploy-model")return {currentAcceptedRelease:()=>null,deployState:()=>({reports:[],turnovers:[],completions:[],evidence:[]})};
  throw new Error(`unexpected_dependency:${name}`);
},module,module.exports);
const {assessJobFinance,dollarsToMinor,moneyMinor}=module.exports;
const read={currency:"USD",baseline:{pricingBasis:{priceMinor:10000000,currency:"USD"}},
  changes:[{id:"authorized-1",packageId:"package-1",priceAmount:"2600.00",currency:"USD",customerAuthorization:{evidenceId:"doc-1"},revisedReleaseId:"release-2"}],
  costs:[{id:"commit-1",kind:"Committed",amount_minor:50000,reconciles_id:null},{id:"actual-1",kind:"Incurred",amount_minor:30000,reconciles_id:"commit-1"},{id:"actual-2",kind:"Incurred",amount_minor:100000,reconciles_id:null}],
  remainingForecastMinor:500000,forecastSource:"FICTIONAL source",forecastAt:"2026-10-09",bills:[],cashEvents:[]};
const work={packages:[]};const result=assessJobFinance(read,work);
if(result.original!==10000000||result.revised!==10260000||result.incurred!==130000||result.outstanding!==20000||result.forecastFinal!==650000||result.forecastProfit!==9610000||Math.abs(result.forecastMargin-9610000/10260000*100)>1e-9)throw new Error("finance_composition_wrong");
if(dollarsToMinor("2.30")!==230||dollarsToMinor("2.345")!==null||moneyMinor(null)!=="Unknown")throw new Error("money_precision_wrong");
if(assessJobFinance({...read,remainingForecastMinor:null},work).forecastMargin!==null)throw new Error("missing_forecast_became_zero");
if(assessJobFinance({...read,changes:[{...read.changes[0],currency:"GBP"}]},work).revised!==null)throw new Error("mixed_currency_aggregated");
if(assessJobFinance({...read,costs:[{...read.costs[0],amount_minor:Number.MAX_SAFE_INTEGER},{...read.costs[0],id:"commit-2",amount_minor:100}]},work).outstanding!==null)throw new Error("overflow_was_precise");
console.log(JSON.stringify({originalMinor:result.original,revisedMinor:result.revised,incurredMinor:result.incurred,outstandingMinor:result.outstanding,forecastFinalMinor:result.forecastFinal,forecastMarginPercent:result.forecastMargin,unknownPreserved:true,mixedCurrencyBlocked:true}));