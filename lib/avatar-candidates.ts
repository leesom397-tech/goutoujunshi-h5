export type AvatarCandidate={imageIndex:number;x:number;y:number;width:number;height:number;side:string};
export const AVATAR_GUIDANCE="另返回avatarCandidates数组，最多3项：{imageIndex,x,y,width,height,side}。只定位页面明确的个人头像，不识别人脸身份，不选择正文照片、广告或评论者头像。imageIndex为本次输入图片零基索引；x,y,width,height均为相对于整张图片的0到1比例，矩形紧贴头像。聊天头像side为left或right；个人主页或朋友圈主人头像side为profile。没有清晰头像就[]。坐标只用于让用户预览裁剪并确认，不自动存档。";
export function avatarCandidates(value:unknown):AvatarCandidate[]{
  if(!Array.isArray(value))return [];
  return value.slice(0,3).flatMap(v=>{
    if(!v||typeof v!=="object"||!["left","right","profile"].includes(v.side))return [];
    if(!Number.isInteger(v.imageIndex)||v.imageIndex<0||v.imageIndex>8)return [];
    if(![v.x,v.y,v.width,v.height].every(n=>typeof n==="number"&&Number.isFinite(n)))return [];
    if(v.x<0||v.y<0||v.width<=0||v.height<=0||v.x+v.width>1.001||v.y+v.height>1.001)return [];
    return [{imageIndex:v.imageIndex,x:v.x,y:v.y,width:v.width,height:v.height,side:v.side}];
  });
}
