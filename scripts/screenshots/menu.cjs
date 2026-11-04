const board = require('./menu-board.cjs');
module.exports = async (_root,output) => {
  const {trayCapsuleImage,buildScrollStrip,scrollCapsuleFrame}=require('../../dist-electron/trayCapsule.js');
  const {dotImage}=require('../../dist-electron/trayIcon.js');
  const {logoTrayImage}=require('../../dist-electron/logos.js');
  const entries=[{symbol:'SOFI',priceText:'$18.25',direction:'up'},{symbol:'AAPL',priceText:'$228.40',direction:'up'},{symbol:'MSFT',priceText:'$416.25',direction:'down'}];
  const rows=[];
  const logo=logoTrayImage('SOFI');
  if(logo)rows.push({label:'Bundled company-logo tray icon · SOFI',png:logo.toPNG()});
  rows.push({label:'Fallback tray dots · up / down / unchanged',png:['up','down','flat'].map(direction=>dotImage(direction,true).toPNG())});
  for(const [label,stacked,shown,pastel,color,showSymbol] of [
    ['Inline prices · logo and ticker labels',false,entries,true,true,true],
    ['Two ticker stack',true,entries.slice(0,2),true,true,true],
    ['Single ticker · one rotation frame',false,entries.slice(0,1),true,true,true],
    ['Logo and price · ticker label hidden',false,entries.slice(0,1),true,true,false],
    ['Saturated price colors',false,entries,false,true,true],
    ['Price coloring switched off',false,entries,true,false,true],
  ]) rows.push({label,png:(await trayCapsuleImage({entries:shown,stacked,pastel,color,showSymbol})).toPNG()});
  const strip=await buildScrollStrip(entries,true,true,true);
  rows.push({label:'Scrolling mode · static frame of the moving strip',png:scrollCapsuleFrame(strip,220,24,true).toPNG()});
  return board(output,'menu-bar.png','Tickr · menu-bar and tray views',rows,'Actual Tickr company-logo and fallback icons, inline and stacked prices, rotation and scrolling frames, and color/symbol options. All prices are fictional.');
};
