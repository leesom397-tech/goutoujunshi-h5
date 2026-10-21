/** Display measurements, never turn elapsed time into invented completion. */
export function waitingDuration(milliseconds:number) {
  const seconds=Math.max(0,Math.floor((Number.isFinite(milliseconds)?milliseconds:0)/1000));
  if(seconds<60)return `${seconds} 秒`;
  const minutes=Math.floor(seconds/60),remaining=seconds%60;
  if(minutes<60)return `${minutes} 分 ${String(remaining).padStart(2,"0")} 秒`;
  return `${Math.floor(minutes/60)} 小时 ${minutes%60} 分`;
}

export function remainingTimeRange(completed:number,remaining:number,elapsedMs:number):string|null {
  // A short initial burst, no known total, or a complete batch cannot produce an ETA.
  if(![completed,remaining,elapsedMs].every(Number.isFinite)||completed<=0||remaining<=0||elapsedMs<8000)return null;
  const estimate=remaining/completed*elapsedMs;
  if(!Number.isFinite(estimate)||estimate>24*3600000)return null;
  const low=Math.max(5,Math.floor(estimate*.65/5000)*5),high=Math.max(low+5,Math.ceil(estimate*1.6/5000)*5);
  if(high<60)return `${low}–${high} 秒`;
  if(low<60)return `${low} 秒–${Math.ceil(high/60)} 分钟`;
  const lower=Math.max(1,Math.floor(low/60)),upper=Math.max(lower+1,Math.ceil(high/60));
  return `${lower}–${upper} 分钟`;
}

export type ImportTiming={startedAt:number;contactKey:string};
export function importTimingStart(previous:ImportTiming|null,contactKey:string,now:number,resume=false,fallback=0):ImportTiming {
  const valid=(value:number)=>Number.isFinite(value)&&value>0&&value<=now;
  const startedAt=resume&&previous?.contactKey===contactKey&&valid(previous.startedAt)?previous.startedAt:resume&&valid(fallback)?fallback:now;
  return {startedAt,contactKey};
}
