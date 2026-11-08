
const fs=require("fs"), vm=require("vm"), B="/home/user/Projects/fitness-app/";
const SRC=["js/data.js","js/engine.js","js/store.js"].map(f=>fs.readFileSync(B+f,"utf8")).join("\n;\n");
function env(ls={}){const store=Object.assign({},ls);
 const s={console:{log(){},warn:console.warn,error:console.error,info(){}},Date,Math,JSON,Object,Array,Number,String,Boolean,RegExp,Promise,Error,isFinite,parseInt,parseFloat,Set,Map,setTimeout,clearTimeout,
  document:{addEventListener(){},removeEventListener(){}},window:{},
  localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},module:{exports:{}}};
 s.globalThis=s;vm.createContext(s);vm.runInContext(SRC+"\n;globalThis.__X={Engine,Store,EXERCISE_LIB};",s,{filename:"b.js"});
 return {E:s.__X.Engine,S:s.__X.Store,LIB:s.__X.EXERCISE_LIB};}

const TODAY = new Date().toISOString().slice(0,10);
console.log("today (UTC slice):", TODAY);
const real = env({});
const recent = new Date(Date.now()-2*864e5).toISOString().slice(0,10);
const st = {version:1,createdAt:"x",profile:{name:"c",sex:"M",heightCm:180,weightKg:82,bodyFatPct:18,goalWeightKg:78,weeklyTarget:4,units:"kg"},
 workouts:[{id:"w1",date:recent,note:"",entries:[{id:73,name:"Bench Press",mode:"weight_reps",sets:[{w:100,r:10},{w:105,r:5}]}]}],
 bodylog:[{date:recent,weightKg:82,bodyFatPct:18}],overrides:{},custom:[],achievements:{},settings:{sound:false,seeded:true}};
const e = env({"fitness-app-v1":JSON.stringify(st)});
console.log("workouts loaded:", e.S.state.workouts.length, "date:", e.S.state.workouts[0].date);
console.log("exMode(73):", e.E.exMode(e.S.state,73), "exGroups(73):", JSON.stringify(e.E.exGroups(e.S.state,73)));
const mg = e.E.muscleGroups(e.S.state, 30);
console.log("muscleGroups(30d):", JSON.stringify(mg));
console.log("trainedExerciseIds(30):", JSON.stringify(e.E.trainedExerciseIds(e.S.state,30)));
const attrs = e.E.attributes(e.S.state,30);
console.log("attrs:", JSON.stringify(attrs));
console.log();
console.log("=== VIT on an EMPTY install ===");
const empty = env({});
const a2 = empty.E.attributes(empty.S.state, 28);
console.log("VIT:", JSON.stringify(a2.VIT), "| bw used:", empty.E.bodyweight(empty.S.state));
console.log();
console.log("=== does the library know exercise 73? ===");
const x = e.LIB.find(v=>v.id===73);
console.log("73 =", x?x.n+" groups="+JSON.stringify(x.g):"NOT FOUND");
