/* ===========================================================================
   THE LOOK
   The photograph behind all three pages, chosen at /admin and carried in the
   content as THEME (see tree-data.js). This file is the one place that
   decides what a THEME is allowed to say and turns it into CSS, so the tree,
   the editor and /work cannot come to different conclusions about the same
   record.

   It paints through four custom properties on <html> that theme.css reads,
   each with a fallback that is today's backdrop. If this file does not load,
   nothing looks different from the shipped page; if a THEME is malformed, it
   is cleaned back to something valid rather than trusted.

   The second half of the file is the other thing all three pages must
   agree on: what content may say before any of it reaches innerHTML (see
   WHAT CONTENT MAY SAY below).

   Loaded right after tree-data.js on every page.
   ========================================================================= */
(function(){
"use strict";

/* Frozen, because every page reads it and none of them may change it. */
var DEFAULT=Object.freeze({photo:'land.jpg',position:56,opacityLight:null,opacityDark:null});

/* The whole list of photographs a THEME may name. It is deliberately a
   list and not a pattern for "a URL": the value ends up inside url(), where
   free text could close the function and write CSS of its own, and this
   tool promises readers it makes no request to anywhere else, which a link
   to another site's image would quietly break. An uploaded image is named by
   its SHA-256, which is all the media route will serve. The server applies
   the same list when a tree is published. */
var MEDIA=/^\/api\/media\/[a-f0-9]{64}$/;
function okPhoto(p){
  return p==='land.jpg'||p===''||(typeof p==='string'&&MEDIA.test(p));
}
/* A number, or nothing. Only real numbers count: a string that looks like
   one is as likely to be half-typed as meant. */
function clamp(v,lo,hi){
  if(typeof v!=='number'||!isFinite(v)) return null;
  return Math.min(hi,Math.max(lo,v));
}

/* A new, normalised THEME: only the four known keys, each valid, anything
   missing or wrong taken from DEFAULT. Never throws, whatever it is given. */
function clean(theme){
  var t=(theme&&typeof theme==='object')?theme:{};
  var out={photo:DEFAULT.photo,position:DEFAULT.position,
           opacityLight:DEFAULT.opacityLight,opacityDark:DEFAULT.opacityDark};
  try{
    if(okPhoto(t.photo)) out.photo=t.photo;
    var pos=clamp(t.position,0,100);
    if(pos!==null) out.position=pos;
    /* null is a real value here, meaning "whatever theme.css says" */
    out.opacityLight=clamp(t.opacityLight,0,1);
    out.opacityDark=clamp(t.opacityDark,0,1);
  }catch(e){}
  return out;
}

/* THEME records from different places laid over each other, key by key: a
   later record wins for each key it actually carries, and a key it lacks —
   because it was written before that key existed — keeps the earlier value.
   Each layer is cleaned first, so an invalid photo in a later record falls
   back to the default rather than being passed through. */
function merge(){
  var out=clean(arguments[0]);
  for(var i=1;i<arguments.length;i++){
    var t=arguments[i];
    if(!t||typeof t!=='object') continue;
    var c=clean(t);
    for(var k in DEFAULT){
      if(Object.prototype.hasOwnProperty.call(t,k)&&t[k]!==undefined) out[k]=c[k];
    }
  }
  return out;
}

/* Paint a THEME. The photograph's address is made absolute before it goes
   into the property: a relative url() inside a custom property is resolved
   against different bases by different browsers, and an absolute one means
   the same thing everywhere. The list above already rules out quotes and
   backslashes; escaping them again costs nothing. */
function apply(theme){
  var t=clean(theme);
  try{
    var s=document.documentElement.style;
    if(t.photo){
      var u=t.photo;
      try{ u=new URL(t.photo,location.href).href; }catch(e){}
      s.setProperty('--photo-url','url("'+String(u).replace(/["\\\n\r]/g,'')+'")');
    }else{
      s.setProperty('--photo-url','none');
    }
    s.setProperty('--photo-pos','50% '+t.position+'%');
    if(t.opacityLight===null) s.removeProperty('--photo-op-l');
    else s.setProperty('--photo-op-l',String(t.opacityLight));
    if(t.opacityDark===null) s.removeProperty('--photo-op-d');
    else s.setProperty('--photo-op-d',String(t.opacityDark));
  }catch(e){}
  return t;
}

/* For a page with no content pipeline of its own — /work. The precedence is
   the reader's: what the repo ships, then what the editor published, then
   this browser's draft from /admin. Like the reader, it does not ask for the
   published tree at all while a draft exists, because the draft is the
   editor previewing their own work and outranks it wholesale; a draft old
   enough to carry no THEME therefore shows the shipped photograph on both
   pages rather than a different one on each. Every failure is silent: the
   CSS fallback is a complete backdrop. */
function boot(){
  var shipped=(window.TAS_TREE&&window.TAS_TREE.THEME)||null;
  apply(shipped);
  /* "A draft exists" means what it means to the reader: the key is set,
     whether or not what is in it parses. */
  var raw=null, draft={};
  try{ raw=localStorage.getItem('tas-tree-draft'); }catch(e){}
  if(raw){
    try{ draft=JSON.parse(raw)||{}; }catch(e){}
    apply(merge(shipped,draft.THEME));
    return;
  }
  if(!window.fetch) return;
  try{
    fetch('/api/tree',{cache:'no-store',headers:{Accept:'application/json'}})
      .then(function(r){ return r.ok?r.json():null; })
      .then(function(d){
        if(d&&d.published&&d.data&&d.data.THEME) apply(merge(shipped,d.data.THEME));
      })
      .catch(function(){});
  }catch(e){}
}

/* ===========================================================================
   WHAT CONTENT MAY SAY
   A browser copy of api/_lib/markup.js, the filter every string of a
   published or saved tree passes through on the server. It lives here, in
   the one script all three pages load, because content also reaches a page
   by a route the server never sees: the /admin draft in localStorage, which
   Import fills with whatever JSON was pasted into it. The reader renders
   content with innerHTML, and it renders the draft in the editor's own
   session when the editor previews it, so a hostile exported tree imported
   once would otherwise run script on this origin with the publisher's cookie
   behind it. The reader also runs what the API hands back (the published
   tree, a saved tree, the snapshot inside a saved path) through it, so a
   record written before the server filter existed is held to the same rules.

   It is a port, not a new design: the same tokenizer, the same short lists
   of tags and attributes, the same URL rules (http, https, mailto and tel
   for links; this site, or an inline raster data: image, for an img src),
   and the same rebuilding of every kept tag from scratch, so nothing of the
   original spelling survives; the same class allowlist, the same balancing
   of every fragment, and the same reduction of CONTACT to plain text. Change
   one and change the other: scripts/look-parity.mjs fails on any difference
   in output between the two, and on shipped content the filter would alter.
   The reason for each rule is written beside it in markup.js and is not
   repeated here.
   ========================================================================= */
function set(list){
  var o=Object.create(null);
  for(var i=0;i<list.length;i++) o[list[i]]=true;
  return o;
}
function has(o,k){ return Object.prototype.hasOwnProperty.call(o,k); }
function isArray(v){ return Object.prototype.toString.call(v)==='[object Array]'; }

var DROP_WITH_CONTENT=set(['script','style','iframe','frame','frameset','noscript',
  'noembed','noframes','textarea','title','xmp','plaintext','template','object',
  'embed','applet','select']);
var HTML_TAGS=['a','abbr','article','aside','b','bdi','bdo','blockquote','br','caption',
  'cite','code','col','colgroup','dd','del','details','dfn','div','dl','dt',
  'em','figcaption','figure','font','footer','h1','h2','h3','h4','h5','h6',
  'header','hr','i','img','ins','kbd','li','main','mark','ol','p','pre','q',
  's','samp','section','small','span','strong','sub','summary','sup','table',
  'tbody','td','tfoot','th','thead','time','tr','u','ul','var','wbr'];
var SVG_TAGS=['svg','g','path','line','polyline','polygon','rect','circle','ellipse',
  'text','tspan'];
var TAGS=set(HTML_TAGS.concat(SVG_TAGS));
var SVG_SET=set(SVG_TAGS);
var SVG_NS='http://www.w3.org/2000/svg';
var GLOBAL_ATTRS=set(['class','title','lang','dir','role','style']);
/* The class names content may carry, as in markup.js CLASSES: a class can
   borrow one of the page's own full-screen overlay rules (.tasa-ovl, .ovl),
   so only the names shipped content uses survive. */
var CLASSES={content:set(['wnote']),
             document:set(['wnote','pstamp','pc','psx','pd','ptree'])};
var VOID=set(['br','hr','img','col','wbr']);
var TAG_ATTRS={
  a:set(['href','target','rel']),
  img:set(['src','alt','width','height']),
  td:set(['colspan','rowspan','headers']),
  th:set(['colspan','rowspan','headers','scope']),
  col:set(['span']),
  colgroup:set(['span']),
  ol:set(['start','reversed','type']),
  li:set(['value']),
  time:set(['datetime']),
  details:set(['open']),
  font:set(['color','face','size'])
};
var SVG_ATTRS=set(['viewbox','preserveaspectratio','xmlns','width','height','x','y','x1','y1',
  'x2','y2','cx','cy','r','rx','ry','d','points','dx','dy','rotate',
  'textlength','lengthadjust','fill','fill-opacity','fill-rule','stroke',
  'stroke-width','stroke-opacity','stroke-dasharray','stroke-dashoffset',
  'stroke-linecap','stroke-linejoin','stroke-miterlimit','opacity','transform',
  'text-anchor','dominant-baseline','alignment-baseline','font-size','font-family',
  'font-weight','font-style','letter-spacing','word-spacing','text-decoration',
  'clip-rule','vector-effect','paint-order','shape-rendering','visibility',
  'focusable']);
var STYLE_PROPS=set(['color','background-color','font','font-size','font-weight','font-style',
  'font-family','font-variant','text-align','text-decoration','text-transform',
  'text-indent','line-height','letter-spacing','word-spacing','white-space',
  'vertical-align','margin','margin-top','margin-right','margin-bottom',
  'margin-left','padding','padding-top','padding-right','padding-bottom',
  'padding-left','border','border-top','border-right','border-bottom',
  'border-left','border-color','border-style','border-width','border-radius',
  'border-collapse','width','max-width','min-width','height','list-style-type',
  'list-style-position','opacity','display','fill','stroke','stroke-width',
  'stroke-dasharray','fill-opacity','stroke-opacity','text-anchor',
  'dominant-baseline']);
var NAMED={
  amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',colon:':',
  sol:'/',bsol:'\\',tab:'\t',newline:'\n',lpar:'(',rpar:')',period:'.',
  comma:',',excl:'!',num:'#',percnt:'%',equals:'=',semi:';',quest:'?',
  commat:'@',lowbar:'_',hyphen:'-',plus:'+',ast:'*',dollar:'$',lsqb:'[',
  rsqb:']',lbrace:'{',rbrace:'}',verbar:'|',grave:'`',Hat:'^',
  mdash:'\u2014',ndash:'\u2013',hellip:'\u2026',lsquo:'\u2018',rsquo:'\u2019',
  ldquo:'\u201c',rdquo:'\u201d',middot:'\u00b7',bull:'\u2022',copy:'\u00a9',
  reg:'\u00ae',trade:'\u2122',sect:'\u00a7',para:'\u00b6',deg:'\u00b0',
  times:'\u00d7',divide:'\u00f7',plusmn:'\u00b1',larr:'\u2190',rarr:'\u2192',
  uarr:'\u2191',darr:'\u2193',eacute:'\u00e9',egrave:'\u00e8',aacute:'\u00e1',
  agrave:'\u00e0',oacute:'\u00f3',uacute:'\u00fa',iacute:'\u00ed',ntilde:'\u00f1',
  ccedil:'\u00e7',ouml:'\u00f6',uuml:'\u00fc',auml:'\u00e4',shy:'\u00ad'
};

function fromCode(c){
  if(String.fromCodePoint) return String.fromCodePoint(c);
  if(c<0x10000) return String.fromCharCode(c);
  c-=0x10000;
  return String.fromCharCode(0xd800+(c>>10),0xdc00+(c&0x3ff));
}
/* A group that did not take part comes back undefined in some engines and
   as '' in older ones, so both mean "not this branch". */
function decodeEntities(s){
  return String(s).replace(
    /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([a-zA-Z][a-zA-Z0-9]{0,31});)/g,
    function(m,hex,dec,name){
      if(name) return has(NAMED,name)?NAMED[name]:m;
      var code=hex?parseInt(hex,16):parseInt(dec,10);
      if(!code||code>0x10ffff||(code>=0xd800&&code<=0xdfff)) return '\ufffd';
      return fromCode(code);
    });
}
function escAttr(v){
  return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function schemeOf(url){
  var bare=String(url).replace(/[\u0000-\u0020]+/g,'');
  var m=/^([a-z][a-z0-9+.\-]*):/i.exec(bare);
  return {bare:bare,scheme:m?m[1].toLowerCase():null};
}
var LINK_SCHEMES=set(['http','https','mailto','tel']);
function safeHref(url){
  var s=schemeOf(url).scheme;
  return s===null||LINK_SCHEMES[s]===true;
}
function safeSrc(url){
  var o=schemeOf(url);
  if(o.scheme===null) return !/^[\\\/]{2}/.test(o.bare);
  return o.scheme==='data'&&/^data:image\/(png|jpeg|gif|webp)[;,]/i.test(o.bare);
}
var REACHES=/url\s*\(|image-set\s*\(|expression\s*\(|javascript:|vbscript:|@import|-moz-binding|behavior\s*:/i;
function cleanStyle(value){
  var kept=[], decls=String(value).split(';');
  for(var d=0;d<decls.length;d++){
    var decl=decls[d], i=decl.indexOf(':');
    if(i<1) continue;
    var prop=decl.slice(0,i).trim().toLowerCase();
    var val=decl.slice(i+1).trim();
    if(STYLE_PROPS[prop]!==true||!val) continue;
    if(/[\\<>{}]|\/\*/.test(val)||REACHES.test(val)) continue;
    if(prop.indexOf('margin')===0&&val.indexOf('-')>=0) continue;
    kept.push(prop+':'+val);
  }
  return kept.join(';');
}
function keepAttr(tag,name,raw,classes){
  if(!/^[a-z][a-z0-9:_.-]*$/i.test(name)) return null;
  var n=name.toLowerCase();
  var value=decodeEntities(raw);
  var allowed=GLOBAL_ATTRS[n]===true||
    (has(TAG_ATTRS,tag)&&TAG_ATTRS[tag][n]===true)||
    (SVG_SET[tag]===true&&SVG_ATTRS[n]===true)||
    ((n.indexOf('data-')===0||n.indexOf('aria-')===0)&&n.length>5&&n.indexOf(':')<0);
  if(!allowed) return null;
  if(n==='style'){ var st=cleanStyle(value); return st?st:null; }
  if(n==='class'){
    var cls=value.split(/[\t\n\f\r ]+/).filter(function(c){ return c&&classes[c]===true; });
    return cls.length?cls.join(' '):null;
  }
  if(n==='href') return safeHref(value)?value:null;
  if(n==='src') return safeSrc(value)?value:null;
  if(n==='xmlns') return value===SVG_NS?value:null;
  if(n==='target') return /^_(blank|self)$/i.test(value.trim())?value.trim():null;
  if(n==='rel'){
    var rel=value.toLowerCase().split(/\s+/).filter(function(t){
      return t==='noopener'||t==='noreferrer'||t==='nofollow'||t==='external';
    });
    return rel.length?rel.join(' '):null;
  }
  if(REACHES.test(value)) return null;
  return value;
}

var WS=/[\t\n\f\r ]/;
function readTag(s,at){
  var i=at+1, end=false;
  if(s.charAt(i)==='/'){ end=true; i++; }
  if(!/[a-zA-Z]/.test(s.charAt(i))) return undefined;
  var nameStart=i;
  while(i<s.length&&!WS.test(s.charAt(i))&&s.charAt(i)!=='/'&&s.charAt(i)!=='>') i++;
  var name=s.slice(nameStart,i).toLowerCase();
  var attrs=[], selfClosing=false;
  for(;;){
    while(i<s.length&&(WS.test(s.charAt(i))||s.charAt(i)==='/')){
      if(s.charAt(i)==='/'&&s.charAt(i+1)==='>'){ selfClosing=true; i++; break; }
      i++;
    }
    if(i>=s.length) return null;
    if(s.charAt(i)==='>') return {name:name,end:end,attrs:attrs,selfClosing:selfClosing,next:i+1};
    var aStart=i;
    i++;
    while(i<s.length&&!WS.test(s.charAt(i))&&s.charAt(i)!=='/'&&s.charAt(i)!=='>'&&s.charAt(i)!=='=') i++;
    var aName=s.slice(aStart,i);
    while(i<s.length&&WS.test(s.charAt(i))) i++;
    if(i>=s.length) return null;
    if(s.charAt(i)!=='='){ attrs.push([aName,'',true]); continue; }
    i++;
    while(i<s.length&&WS.test(s.charAt(i))) i++;
    if(i>=s.length) return null;
    var q=s.charAt(i);
    if(q==='"'||q==="'"){
      var close=s.indexOf(q,i+1);
      if(close<0) return null;
      attrs.push([aName,s.slice(i+1,close)]);
      i=close+1;
    }else if(q==='>'){
      attrs.push([aName,'']);
    }else{
      var vStart=i;
      while(i<s.length&&!WS.test(s.charAt(i))&&s.charAt(i)!=='>') i++;
      attrs.push([aName,s.slice(vStart,i)]);
    }
  }
}
function writeTag(t,classes){
  if(t.end) return '</'+t.name+'>';
  var seen=Object.create(null), out='<'+t.name;
  for(var a=0;a<t.attrs.length;a++){
    var name=t.attrs[a][0], raw=t.attrs[a][1], bare=t.attrs[a][2];
    var key=name.toLowerCase();
    if(seen[key]) continue;
    seen[key]=true;
    var v=keepAttr(t.name,name,raw,classes);
    if(v===null) continue;
    out+=(bare&&v==='')?' '+name:' '+name+'="'+escAttr(v)+'"';
  }
  return out+(t.selfClosing&&SVG_SET[t.name]===true?'/>':'>');
}
function inert(text){ return text.replace(/<(?=[a-zA-Z\/!?])/g,'&lt;'); }

/* Balanced, as in markup.js: every element opened is closed by the end of
   the fragment and an end tag for nothing open is dropped, so fragments the
   reader joins cannot close the page's own boxes or swallow what follows.
   options.classes is 'content' (the default) or 'document'. */
function cleanHtml(html,options){
  var s=String(html==null?'':html).replace(/\u0000/g,'');
  if(s.indexOf('<')<0) return s;
  var classes=(options&&options.classes==='document')?CLASSES.document:CLASSES.content;
  var open=[];
  var out=balanced(s,classes,open);
  for(var k=open.length-1;k>=0;k--) out+='</'+open[k]+'>';
  return out;
}
function balanced(s,classes,open){
  var out='', i=0;
  while(i<s.length){
    var lt=s.indexOf('<',i);
    if(lt<0){ out+=s.slice(i); break; }
    out+=s.slice(i,lt);
    if(s.substr(lt,4)==='<!--'){
      var cc=s.indexOf('-->',lt+4);
      if(cc<0) break;
      i=cc+3;
      continue;
    }
    var t=readTag(s,lt);
    if(t===undefined){
      out+=/[\/!?]/.test(s.charAt(lt+1))?'&lt;':'<';
      i=lt+1;
      continue;
    }
    if(t===null){ out+=inert(s.slice(lt)); break; }
    i=t.next;
    if(!t.end&&DROP_WITH_CONTENT[t.name]===true){
      var endRe=new RegExp('</'+t.name,'gi');
      endRe.lastIndex=i;
      var found=endRe.exec(s);
      if(!found) break;
      var after=s.indexOf('>',found.index);
      if(after<0) break;
      i=after+1;
      continue;
    }
    if(TAGS[t.name]!==true) continue;
    if(t.end){
      var at=open.lastIndexOf(t.name);
      if(at<0) continue;
      while(open.length>at) out+='</'+open.pop()+'>';
      continue;
    }
    out+=writeTag(t,classes);
    if(VOID[t.name]!==true&&!(t.selfClosing&&SVG_SET[t.name]===true)) open.push(t.name);
  }
  return out;
}

function cleanUrl(url){
  var v=String(url==null?'':url).trim().replace(/[\u0000-\u001f\u007f]/g,'');
  if(!v||!safeHref(v)) return '#';
  return v.replace(/[\s"'<>`]/g,function(c){
    var h=c.charCodeAt(0).toString(16).toUpperCase();
    return '%'+(h.length<2?'0'+h:h);
  });
}

/* CONTACT, as records.js cleanContact reduces it: four plain-text fields
   with nothing that could open a tag (the reader escapes each one where it
   shows it, so an apostrophe in a name is kept), and a
   calendly that is an https: URL or nothing (the reader's calLink() then
   decides whether it may be embedded). Anything else in it is dropped. */
function str(v,max){
  var s=String(v).trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'');
  return s.length>max?s.slice(0,max):s;
}
function plainText(v,max){
  if(typeof v!=='string') return '';
  return str(v.replace(/<[^>]*>?/g,''),max).replace(/[<>]/g,'');
}
function cleanContact(contact){
  var c=(contact&&typeof contact==='object'&&!isArray(contact))?contact:{};
  var cal=typeof c.calendly==='string'?cleanUrl(str(c.calendly,2000)):'';
  return {
    name:plainText(c.name,160),
    role:plainText(c.role,160),
    email:plainText(c.email,254),
    phone:plainText(c.phone,60),
    calendly:/^https:\/\/[^\/?#\s]/i.test(cal)?cal:''
  };
}

/* A whole tree, the way records.js cleanTreeData treats one: every string
   leaf through cleanHtml, CONTACT through cleanContact, and each LINKS[].u
   through cleanUrl, because the reader concatenates it between the quotes of
   an href where the tag filter cannot see it. THEME is handed back as it
   came: clean() and merge() above are its filter, and merge() needs to see
   which keys the record carried.

   Unlike the server this never refuses anything. A draft is the editor's
   own browser talking to itself, with nobody to show an error to, so what
   cannot be content (a function, something nested absurdly deep) becomes
   null, and a key spelled __proto__ is dropped rather than allowed to
   rewrite the new object's prototype. Returns null for what is not a tree
   at all, and never throws. */
var MAX_DEPTH=40;
function cleanLeaves(v,depth){
  if(depth>MAX_DEPTH) return null;
  if(typeof v==='string') return cleanHtml(v);
  if(v===null||typeof v==='boolean'||(typeof v==='number'&&isFinite(v))) return v;
  if(isArray(v)){
    var arr=[];
    for(var i=0;i<v.length;i++) arr.push(cleanLeaves(v[i],depth+1));
    return arr;
  }
  if(typeof v==='object'){
    var out={};
    for(var k in v){
      if(!has(v,k)||k==='__proto__') continue;
      out[k]=cleanLeaves(v[k],depth+1);
    }
    return out;
  }
  return null;
}
function cleanTree(data){
  if(!data||typeof data!=='object'||isArray(data)) return null;
  try{
    var out={};
    for(var k in data){
      if(!has(data,k)||k==='__proto__') continue;
      out[k]=(k==='THEME')?data[k]:
             (k==='CONTACT')?cleanContact(data[k]):
             cleanLeaves(data[k],0);
    }
    if(isArray(out.LINKS)){
      out.LINKS=out.LINKS.map(function(l){
        if(!l||typeof l!=='object'||isArray(l)) return l;
        var c={};
        for(var lk in l) if(has(l,lk)) c[lk]=l[lk];
        c.u=cleanUrl(l.u);
        return c;
      });
    }
    return out;
  }catch(e){ return null; }
}

var LOOK={DEFAULT:DEFAULT,clean:clean,merge:merge,apply:apply,boot:boot,
          cleanHtml:cleanHtml,cleanUrl:cleanUrl,cleanContact:cleanContact,
          cleanTree:cleanTree};
if(typeof window!=='undefined') window.TAS_LOOK=LOOK;
if(typeof module!=='undefined'&&module.exports) module.exports=LOOK;
})();
