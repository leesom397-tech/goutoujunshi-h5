"use client";
import type {AnchorHTMLAttributes} from 'react';
import {reportOutboundHref} from '@/lib/report-return';
import {navigateReportSession} from '@/lib/report-session-navigation';
import {reportLineKey} from '@/lib/report-reading-position';

/** Capture the current chapter at click time, after the reader saved its offset. */
export function ReportReturnLink({reportId,href,onClick,...props}:AnchorHTMLAttributes<HTMLAnchorElement>&{reportId:string;href:string}){
 return <a data-reading-anchor={reportLineKey({text:href},0)} {...props} href={reportOutboundHref(href,{reportId})} onClick={event=>{
  const destination=reportOutboundHref(href,{reportId,returnTo:location.pathname+location.search+location.hash});
  event.currentTarget.href=destination;
  onClick?.(event);
  // A chapter-state update can rerender this anchor before the browser follows
  // its default href. Use the captured destination for an ordinary click.
  if(!event.defaultPrevented&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();navigateReportSession(destination);}
 }}/>;
}
