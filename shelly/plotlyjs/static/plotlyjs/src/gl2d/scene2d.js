'use strict';

var Plotly = require('../plotly');
var createPlot2D = require('gl-plot2d');
var createSpikes  = require('gl-spikes2d');
var createSelectBox = require('gl-select-box');
var createLineWithMarkers = require('./convert/scattergl');
var createOptions = require('./convert/axes2dgl');
var createCamera  = require('./lib/camera');

var AXES = [ 'xaxis', 'yaxis' ];

function Scene2D(options, fullLayout) {
    var container = this.container = options.container;
    this.fullLayout = fullLayout;

    var width       = fullLayout.width;
    var height      = fullLayout.height;

    //Get pixel ratio
    var pixelRatio = this.pixelRatio = options.pixelRatio || window.devicePixelRatio;

    //Create canvas and append to container
    var canvas = this.canvas = document.createElement('canvas');
    canvas.width        = Math.ceil(pixelRatio * width) |0;
    canvas.height       = Math.ceil(pixelRatio * height)|0;
    canvas.style.width  = '100%';
    canvas.style.height = '100%';
    canvas.style.position = 'absolute';
    canvas.style.top    = '0px';
    canvas.style.left   = '0px';
    canvas.style['z-index'] = '90';

    //Create SVG container for hover text
    var svgContainer = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg');
    svgContainer.style.position = 'absolute';
    svgContainer.style.top   = svgContainer.style.left   = '0px';
    svgContainer.style.width = svgContainer.style.height = '100%';
    svgContainer.style['z-index'] = '91';
    svgContainer.style['pointer-events'] = 'none';
    this.svgContainer = svgContainer;


    //Get webgl context
    var gl;
    try {
      gl = canvas.getContext('webgl', options.glopts);
    } catch(e) {}
    if(!gl) {
      try {
        gl = canvas.getContext('experimental-webgl', options.glopts);
      } catch(e) {}
    }
    if(!gl) {
      throw new Error('webgl not supported!');
    }
    this.gl = gl;

    //Append canvas to conatiner
    container.appendChild(canvas);
    container.appendChild(svgContainer);

    //Update options
    this.glplotOptions = createOptions(this);
    this.glplotOptions.merge(fullLayout);

    //Create the plot
    this.glplot = createPlot2D(this.glplotOptions);

    //Create camera
    this.camera = createCamera(this);

    //Trace set
    this.traces = [];

    //Create axes spikes
    this.spikes = createSpikes(this.glplot);

    this.selectBox = createSelectBox(this.glplot, {
      innerFill: false,
      outerFill: true
    });

    //Last pick result
    this.pickResult = null;

    this.bounds = [Infinity,Infinity,-Infinity,-Infinity];

    //Redraw the plot
    this.redraw = this.draw.bind(this);
    this.redraw();
}

module.exports = Scene2D;

var proto = Scene2D.prototype;

proto.toImage = function(format) {

  if (!format) format = 'png';
  /*
  if(this.staticMode) {
    this.container.appendChild(STATIC_CANVAS);
  }
  */

  //Force redraw
  this.glplot.setDirty(true);
  this.glplot.draw();

  //Grab context and yank out pixels
  var gl = this.glplot.gl;
  var w = gl.drawingBufferWidth;
  var h = gl.drawingBufferHeight;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  var pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  //Flip pixels
  for(var j=0,k=h-1; j<k; ++j, --k) {
      for(var i=0; i<w; ++i) {
          for(var l=0; l<4; ++l) {
              var tmp = pixels[4*(w*j+i)+l];
              pixels[4*(w*j+i)+l] = pixels[4*(w*k+i)+l];
              pixels[4*(w*k+i)+l] = tmp;
          }
      }
  }

  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var context = canvas.getContext('2d');
  var imageData = context.createImageData(w, h);
  imageData.data.set(pixels);
  context.putImageData(imageData, 0, 0);

  var dataURL;

  switch (format) {
      case 'jpeg':
          dataURL = canvas.toDataURL('image/jpeg');
          break;
      case 'webp':
          dataURL = canvas.toDataURL('image/webp');
          break;
      default:
      dataURL = canvas.toDataURL('image/png');
  }

  /*
  if(this.staticMode) {
    this.container.removeChild(STATIC_CANVAS);
  }
  */

  return dataURL;
};

proto.computeTickMarks = function() {
  this.fullLayout.scene2d.xaxis._length =
      this.glplot.viewBox[2] - this.glplot.viewBox[0];
  this.fullLayout.scene2d.yaxis._length =
      this.glplot.viewBox[3] - this.glplot.viewBox[1];
  return [
      Plotly.Axes.calcTicks(this.fullLayout.scene2d.xaxis),
      Plotly.Axes.calcTicks(this.fullLayout.scene2d.yaxis)
  ];
};

function compareTicks(a, b) {
  for(var i=0; i<2; ++i) {
    var aticks = a[i];
    var bticks = b[i];
    if(aticks.length !== bticks.length) {
      return true;
    }
    for(var j=0; j<aticks.length; ++j) {
      if(aticks[j].x !== bticks[j].x) {
        return true;
      }
    }
  }
  return false;
}

proto.cameraChanged = function() {
  var fullLayout = this.fullLayout;
  var camera = this.camera;
  var xrange = fullLayout.scene2d.xaxis.range;
  var yrange = fullLayout.scene2d.yaxis.range;

  this.glplot.setDataBox([
    xrange[0], yrange[0],
    xrange[1], yrange[1]]);

  var nextTicks = this.computeTickMarks();
  var curTicks = this.glplotOptions.ticks;

  if(compareTicks(nextTicks, curTicks)) {
      this.glplotOptions.ticks = nextTicks;
      this.glplotOptions.dataBox = camera.dataBox;
      this.glplot.update(this.glplotOptions);
  }
};

proto.destroy = function() {
  this.glplot.dispose();
};

proto.plot = function(fullData, fullLayout) {
    //Check for resize
    var glplot     = this.glplot;
    var pixelRatio = this.pixelRatio;
    var i, j;
    var trace;

    this.fullLayout = fullLayout;

    var width       = fullLayout.width;
    var height      = fullLayout.height;
    var pixelWidth  = Math.ceil(pixelRatio * width) |0;
    var pixelHeight = Math.ceil(pixelRatio * height)|0;

    var canvas = this.canvas;
    if(canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width        = pixelWidth;
        canvas.height       = pixelHeight;
    }

    if(!fullData) {
        fullData = [];
    } else if(!Array.isArray(fullData)) {
        fullData = [fullData];
    }

i_loop:
    for(i=0; i<fullData.length; ++i) {
        for(j=0; j<this.traces.length; ++j) {
            if(this.traces[j].uid === fullData[i].uid) {
                this.traces[j].update(fullData[i]);
                continue i_loop;
            }
        }
        var newTrace = null;
        switch(fullData[i].type) {
          case 'scattergl':
              newTrace = createLineWithMarkers(this, fullData[i]);
          break;
        }
        if(newTrace) {
            this.traces.push(newTrace);
        }
    }

j_loop:
    for(j=this.traces.length-1; j>=0; --j) {
        for(i=0; i<fullData.length; ++i) {
            if(this.traces[j].uid === fullData[i].uid) {
                continue j_loop;
            }
        }
        trace = this.traces[j];
        trace.dispose();
        this.traces.splice(j, 1);
    }


    var options       = this.glplotOptions;
    options.merge(fullLayout);
    options.screenBox = [0,0,width,height];
    options.viewBox   = [0.125*width,0.125*height,0.875*width,0.875*height];

    var bounds = this.bounds;
    bounds[0] = bounds[1] = Infinity;
    bounds[2] = bounds[3] = -Infinity;

    for(i=0; i<this.traces.length; ++i) {
      trace = this.traces[i];
      for(var k=0; k<2; ++k) {
        bounds[k]   = Math.min(bounds[k], trace.bounds[k]);
        bounds[k+2] = Math.max(bounds[k+2], trace.bounds[k+2]);
      }
    }

    for(i=0; i<2; ++i) {
        if(bounds[i] > bounds[i+2]) {
          bounds[i]   = -1;
          bounds[i+2] = 1;
        }
        var ax = fullLayout.scene2d[AXES[i]];
        ax._min = [{
          val: bounds[i],
          pad: 10
        }];
        ax._max = [{
          val: bounds[i+2],
          pad: 10
        }];
        ax._length = options.viewBox[i+2] - options.viewBox[i];
        Plotly.Axes.doAutoRange(ax);
    }

    options.ticks     = this.computeTickMarks();

    var xrange = fullLayout.scene2d.xaxis.range;
    var yrange = fullLayout.scene2d.yaxis.range;
    options.dataBox   = [xrange[0], yrange[0], xrange[1], yrange[1]];

    glplot.update(options);
};

proto.draw = function() {
    requestAnimationFrame(this.redraw);

    var glplot = this.glplot;
    var camera = this.camera;
    var mouseListener = camera.mouseListener;

    this.cameraChanged();

    var x = mouseListener.x * glplot.pixelRatio;
    var y = this.canvas.height - glplot.pixelRatio * mouseListener.y;

    if(camera.boxEnabled && this.fullLayout.dragmode === 'zoom') {

      this.selectBox.enabled = true;
      this.selectBox.selectBox = [
        Math.min(camera.boxStart[0], camera.boxEnd[0]),
        Math.min(camera.boxStart[1], camera.boxEnd[1]),
        Math.max(camera.boxStart[0], camera.boxEnd[0]),
        Math.max(camera.boxStart[1], camera.boxEnd[1])
      ];

      glplot.setDirty();
    } else {
      this.selectBox.enabled = false;

      var result = glplot.pick(x / glplot.pixelRatio, y / glplot.pixelRatio);
      if(result) {
        var nextSelection = result.object._trace.handlePick(result);
        if(nextSelection &&
          (!this.lastPickResult ||
            this.lastPickResult.trace !== nextSelection.trace ||
            this.lastPickResult.dataCoord[0] !== nextSelection.dataCoord[0] ||
            this.lastPickResult.dataCoord[1] !== nextSelection.dataCoord[1])) {
          var selection = this.lastPickResult = nextSelection;
          this.spikes.update({
            center: result.dataCoord
          });
          selection.screenCoord= [
            ((glplot.viewBox[2] - glplot.viewBox[0]) *
            (result.dataCoord[0] - glplot.dataBox[0]) /
              (glplot.dataBox[2] - glplot.dataBox[0]) + glplot.viewBox[0]) / glplot.pixelRatio,
            (this.canvas.height - (glplot.viewBox[3] - glplot.viewBox[1]) *
            (result.dataCoord[1] - glplot.dataBox[1]) /
              (glplot.dataBox[3] - glplot.dataBox[1]) - glplot.viewBox[1]) / glplot.pixelRatio ];
          Plotly.Fx.loneHover({
            x: selection.screenCoord[0],
            y: selection.screenCoord[1],
            xLabel: selection.traceCoord[0] + '',
            yLabel: selection.traceCoord[1] + '',
            text:   selection.textLabel || '',
            name:   selection.name,
            color:  selection.color
           }, {
             container: this.svgContainer
           });
           this.lastPickResult = {
             dataCoord: result.dataCoord
           };
         }
      } else if(!result && this.lastPickResult) {
        this.spikes.update({});
        this.lastPickResult = null;
        Plotly.Fx.loneUnhover(this.svgContainer);
      }
    }

    glplot.draw();
};
