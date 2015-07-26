var rp  = require('request-promise');
var fs  = require('fs');
var clone = require('clone');
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var gm  = require('gm');//.subClass({imageMagick:true});
var Q   = require('q');
require('q-flow');
var maps = require('./params.json');

var mutableMaps = clone(maps);

var log = function(err) {
    if (err) console.error(err);
}

mkdirp.sync('images');

promiseWhile(function(){
    return mutableMaps.length > 0;
}, function(){
    var cfg = mutableMaps.shift();
    return runProcess(cfg);
})
.then(function(){
   maps.forEach(function(mapCfg){
       rimraf.sync(mapCfg.workingDirectory);
   }); 
});


function runProcess(cfg) {

    var opts = {encoding:null};

    mkdirp.sync(cfg.workingDirectory);
    var promises = [];
        
    var reqs = [];
    
    for (var r = cfg.rows; r <= cfg.maxRows; r++) {
        for (var c = cfg.cols; c <= cfg.maxCols; c++) {
            promises.push(getImage(cfg, opts, c, r));
        }
    }

    return Q.allSettled(promises)
    .then(function(results){
        //now we have an array of file names/rows/cols...
        var newImages = initNewImagesArray(cfg);
        var localRows = cfg.rows;
        var rows = cfg.rows;
        return stitchRows(results, rows, newImages);
    }, log)
    .then(function(newImages){    
        return outputStitches(cfg,newImages);
    }, log)
    .then(function(newImagesPath){
        return stitchToNewImage(cfg, newImagesPath);
    }, log)
    .then(function(newImage){
        return writeOutNewImage(cfg, newImage);
    }, log);
}

function initNewImagesArray(cfg){    
    var newImages = [];
    var width = 256*cfg.wMulti;
    var height = 256;
    for (var x =0; x <= cfg.maxRows-cfg.rows; x++) {
        newImages[x] = gm(width, height);
    }
    return newImages;
}

function initNewImage(cfg){
    var width = 256*cfg.wMulti;
    var height = 256*cfg.hMulti;

    var newImage = gm(width, height);
    return newImage;
}

function stitchRows(results, rows, newImages){
    return Q.Promise(function(resolve,reject){
        var r = rows, result;
        for (var x = 0; x < results.length; x++) {
            result = results[x];
            if (r !== result.value.col) {
                r +=1
            }
            if (r-rows <= newImages.length) {

                newImages[r-rows].append(result.value.file, true);
            } else {
                log("too big");
                reject();
            }
        };
        resolve(newImages);
    });
}

function outputStitches(cfg,newImages){
    return Q.Promise(function(resolve, reject){
        var proms = [], newImagesPath = [];
        var path;
        try {
            for (var x = 0; x < newImages.length; x++) {
                path = cfg.workingDirectory+'/image'+x+'.png';
                proms.push(Q.Promise(function(res2, rej2) {
                    newImages[x].write(path, function(){
                        res2();
                    });
                }));
                newImagesPath.push(path);
                Q.allSettled(proms).then(function(){
                    resolve(newImagesPath);
                });
            }
        //resolve(newImagesPath);
        } catch(e) {
            console.error(e);
            reject();
        }
    });
}

function stitchToNewImage(cfg, newImagesPath) {
    
    return Q.Promise(function(resolve, reject){
        var newImage = initNewImage(cfg)
        for (var x = 0; x < newImagesPath.length; x++) {
            newImage.append(newImagesPath[x], false);
        }
        resolve(newImage);
    });
}

function writeOutNewImage(cfg, newImage) {
    return Q.Promise(function(resolve, reject){
        newImage.write('images/'+cfg.fileName, function(err){
            if (!err)  {
                console.log('done');
                resolve();
            }
            else {
                log(err);
                reject(err);
            }
        })
    });
}

function getImage(cfg, opts, row, col){
    return Q.Promise(function(resolve, reject) {
        opts.url = cfg.url+row+'/'+col+'.png?v=2';
        rp(opts).then(function(img){
            var file = cfg.workingDirectory+'/'+row+':'+col+'.png';
            fs.writeFileSync(file, img);
            resolve({file: file, row: row, col: col});
        }, function(err){
            log(err.msg);
            reject(err);
        });
    })
}

function promiseWhile(condition, action) {
    var resolver = Q.defer();

    var loop = function() {
        if (!condition()) return resolver.resolve();
        return Q.when(action())
            .then(loop)
            .catch(resolver.reject);
    };

    process.nextTick(loop);

    return resolver.promise;
}