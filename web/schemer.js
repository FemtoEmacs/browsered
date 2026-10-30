// Schemer's compiled execution engine. Editor RPC is serviced on the core's
// own stack; compiled imports never re-enter a suspended femtoscheme VM.
(function () {
  var ready, serial=0, jobs=new Map(), modules=new Map(), cache=new Map();
  var telemetry={compiled:0,executed:0,editorCalls:0,cacheHits:0,compileMs:0,runMs:0};
  function initialize() {
    if(!ready) {
      var encoded=document.getElementById('schemer-compiler-wasm').textContent.trim();
      ready=WebAssembly.compile(Uint8Array.from(atob(encoded),function(c){return c.charCodeAt(0);}));
    }
    return ready;
  }
  async function compileRequest(req) {
    var module=await initialize(),printed='';
    var request='('+JSON.stringify(req.source)+' ('+(req.globals||[]).join(' ')+') ('+
      (req.defined||[]).join(' ')+') '+(req.legacy?'#t':'#f')+' #t)';
    var host=schemerHost(function(text){printed+=text;},{
      read:function(path){if(path!==':schemer-request')throw new Error('Unexpected compiler file request');return request;},
      write:function(){throw new Error('Compiler cannot write files');},
      exists:function(){return false;},remove:function(){throw new Error('Compiler cannot remove files');}
    });
    var instance=await WebAssembly.instantiate(module,host.imports);host.setInstance(instance);
    try {instance.exports.main();host.flush();}
    catch(e) {host.flush();throw new Error(printed.trim() || host.message(e) || 'Compiled Scheme compiler failed');}
    if(!/^(?:[0-9a-f]{2})+$/.test(printed) || printed.slice(0,8)!=='0061736d')
      throw new Error(printed.trim() || 'Compiler did not produce WebAssembly');
    return Uint8Array.from(printed.match(/../g),function(s){return parseInt(s,16);});
  }
  function put(job,event) {if(job.waiter){var done=job.waiter;job.waiter=null;done(event);}else job.events.push(event);}
  function rpc(job,text) {
    telemetry.editorCalls++;
    return new Promise(function(resolve) {job.reply=resolve;put(job,'C\n'+text);});
  }
  async function begin(json) {
    var req=JSON.parse(json);await initialize();
    var existing=req.module?modules.get(req.module):null;
    if (req.module && !existing) throw new Error('Compiled module is no longer available');
    var started=performance.now(), key=JSON.stringify([req.source,req.globals,req.defined,req.legacy]), bytes=cache.get(key);
    if (!existing && !bytes) {
      bytes=await compileRequest(req);
      cache.set(key,bytes);telemetry.compiled++;
    } else telemetry.cacheHits++;
    telemetry.compileMs+=performance.now()-started;
    var job={id:++serial,events:[],reply:null,waiter:null};jobs.set(job.id,job);
    var context=existing || {job:job},parentJob=context.job;context.job=job;job.output='';
    var host=context.host;
    if (!existing) {
      host=schemerHost(function(text){context.job.output+=text;});context.host=host;
      if (typeof WebAssembly.Suspending==='function') {
        host.imports.host.editor=new WebAssembly.Suspending(async function(s) {
          return host.fromJS(await rpc(context.job,host.toJS(s)));
        });
        host.imports.host.file=new WebAssembly.Suspending(async function(op,name,data) {
          var path=host.toJS(name),text=op===1?host.toJS(data):'';
          await Module.browsered.call('schemer-prepare-file',path);
          var answer=await rpc(context.job,'(schemer-file-op '+op+' '+JSON.stringify(path)+' '+JSON.stringify(text)+')');
          if(answer.slice(0,3)!=='ok ') throw new Error(answer);
          var value=JSON.parse(JSON.parse(answer.slice(3)));
          return op===0?(value===false?0:host.fromJS(value)):op===2?(value?1:0):0;
        });
      } else {
        host.imports.host.editor=function(){throw new Error('Compiled editor callbacks require WebAssembly JSPI in this browser.');};
      }
      context.instance=(await WebAssembly.instantiate(bytes,host.imports)).instance;
      host.setInstance(context.instance);
    }
    var instance=context.instance;
    // Defer execution so C receives the job id before it services callbacks.
    Promise.resolve().then(async function() {
      var start=performance.now();
      try {
        var entry=existing?instance.exports.call0:instance.exports.main;
        var fn=typeof WebAssembly.promising==='function'?WebAssembly.promising(entry):entry;
        var value=await fn.apply(null,existing?[context.value]:[]);host.flush();
        if(req.keep){context.value=value;modules.set(job.id,context);}
        instance.exports.write(value);var printed=host.text();
        telemetry.executed++;telemetry.runMs+=performance.now()-start;
        put(job,'R\n'+JSON.stringify({ok:true,value:printed,output:job.output,module:req.keep?job.id:undefined,runMs:performance.now()-start}));
      } catch(e) {
        host.flush();
        var diagnostic;
        try { diagnostic=host.message(e); } catch (_) { /* non-Error host rejection */ }
        if(typeof diagnostic!=='string') diagnostic='';
        if(!diagnostic && job.output.trim()) diagnostic=job.output.trim();
        if(!diagnostic) diagnostic=typeof e==='string'?e:'Compiled Scheme execution failed';
        put(job,'R\n'+JSON.stringify({ok:false,error:diagnostic,output:job.output}));
      } finally {context.job=parentJob;}
    });
    return String(job.id);
  }
  window.BrowseredSchemer={
    begin:begin,
    next:function(id){var job=jobs.get(Number(id));if(job.events.length)return Promise.resolve(job.events.shift());return new Promise(function(resolve){job.waiter=resolve;});},
    reply:function(id,text){var job=jobs.get(Number(id)),done=job.reply;job.reply=null;done(text);},
    finish:function(id){jobs.delete(Number(id));},
    status:function(){return JSON.stringify(Object.assign({engine:'Schemer WasmGC',compiler:'self-hosted WasmGC',jspi:typeof WebAssembly.Suspending==='function'},telemetry));}
  };
})();
