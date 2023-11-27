// Helper to parse query string
function getQueryStringValue(name) {
	name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
	let regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
		results = regex.exec(location.search);
	return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

var bitrates = null, bitratesOpts = null, delays = null, delaysOpts = null;
var bitratesZoomed = false, delaysZoomed = false;
var statuses = ['start', 'regular', 'lossy', 'congested', 'recovering'];

var socket = null, connected = false;
var liveHeaders = 'time,status,estimate,probing_target,bitrate_out,rtx_out,probing_out,bitrate_in,rtx_in,probing_in,acked,lost,loss_ratio,avg_delay,avg_delay_weighted,avg_delay_fb'.split(',');
var liveUpdater = null, newData = false;

$(document).ready(function() {
	socket = io.connect();
	socket.on('connect', () => {
		if(connected)
			return;
		connected = true;
		console.log('Connected to API backend');
		// Contact the backend for the data
		let csv = getQueryStringValue('csv');
		loadData(csv);
		socket.on('csv', (msg) => {
			// Got a full CSV to present
			try {
				console.log('Got CSV data:', msg);
				let rows = msg.split('\n');
				let headers = rows[0].split(',');
				let data = rows.slice(1).map(row => {
					let values = row.split(',');
					let obj = {};
					headers.forEach((header, index) => {
						obj[header] = values[index];
					});
					return obj;
				});
				console.log(data);
				for(let fb of data) {
					addBitrate(fb);
					addDelay(fb);
				}
				bitrates.update('none');
				delays.update('none');
			} catch(err) {
				console.error(err);
				bootbox.alert(err.message);
			}
		});
		socket.on('stat', (msg) => {
			// Got a live stat
			try {
				let values = msg.split(',');
				let fb = {};
				liveHeaders.forEach((header, index) => {
					fb[header] = values[index];
				});
				addBitrate(fb);
				addDelay(fb);
				newData = true;
			} catch(err) {
				console.error(err);
			}
		});
		socket.on('error', (msg) => {
			// Something wrong happened
			bootbox.alert(msg);
		});
	});
});

function loadData(csv) {
	// Delete the graphs, if they existed
	try {
		bitrates.destroy();
	} catch(e){};
	bitrates = null;
	bitratesOpts = null;
	try {
		delays.destroy();
	} catch(e){};
	delays = null;
	delaysOpts = null;
	$('#graphs').empty();
	// Cancel the updater if it existed
	if(liveUpdater)
		clearInterval(liveUpdater);
	liveUpdater = null;
	// Create the graphs
	drawBitrates();
	drawDelays();
	// Tell the backend what we want
	socket.emit('context', (csv === '' ? 'live' : csv));
	if(csv === '') {
		liveUpdater = setInterval(function() {
			if(newData) {
				newData = false;
				bitrates.update('none');
				delays.update('none');
			}
		}, 1000);
	}
}

function drawBitrates() {
	$('#graphs').append(
		'<div class="row" style="width:100%;">' +
		'	<button class="btn btn-danger btn-xs hide" id="unzoom">Reset zoom</button>' +
		'</div>' +
		'<div class="row" style="width:100%;">' +
		'	<div class="well" style="width:100%;">' +
		'		<canvas id="canvas0"></canvas>' +
		'	</div>' +
		'</div>'
	);
	let ctx = document.getElementById('canvas0').getContext('2d');
	// Create chart.js graph
	let chartJsOptions = {
		type: 'line',
		data: {
			labels: [],
			datasets: []
		},
		options: {
			scales: {
				x: {
					type: 'time',
					time: {
						tooltipFormat: 'x',
						displayFormats: {
							'millisecond': 'x',
							'second': 'x',
							'minute': 'x',
							'hour': 'x',
							'day': 'x',
							'week': 'x',
							'month': 'x',
							'quarter': 'x',
							'year': 'x',
						}
					},
					title: {
						display: true,
						text: 'Time'
					}
				},
				y: {
					title: {
						display: true,
						text: 'bps'
					}
				}
			},
			plugins: {
				title: {
					display: true,
					text: 'Bitrates and estimate'
				},
				tooltip: {
					mode: 'index',
					intersect: false,
				},
				zoom: {
					zoom: {
						enabled: true,
						drag: {
							enabled: true
						},
						mode: 'x',
						speed: 0.1,
						onZoomComplete: function(chart) {
							console.log('Bitrates zoomed');
							if(bitrates.getZoomLevel() === 1) {
								$('#unzoom').addClass('hide').unbind('click');
							} else {
								$('#unzoom').removeClass('hide').unbind('click').click(function() {
									bitrates.resetZoom();
									delays.resetZoom();
									$('#unzoom').addClass('hide').unbind('click');
								});
							}
							// Apply the same zoom to the other graph
							if(!delaysZoomed) {
								console.log('Zooming delays too');
								delays.zoomScale('x', { min: bitrates.scales.x.min, max: bitrates.scales.x.max });
							}
							bitratesZoomed = false;
							delaysZoomed = false;
						}
					}
				}
			}
		}
	};
	chartJsOptions.data.datasets[0] = {
		label: 'Sent (all)',
		fill: false,
		backgroundColor: 'blue',
		borderColor: 'blue',
		pointBackgroundColor: 'blue',
		pointBorderColor: 'blue',
		lineTension: 0,
		pointRadius: 0,
		data: []
	};
	chartJsOptions.data.datasets[1] = {
		label: 'Sent (RTP)',
		fill: false,
		backgroundColor: 'purple',
		borderColor: 'purple',
		pointBackgroundColor: 'purple',
		pointBorderColor: 'purple',
		lineTension: 0,
		pointRadius: 0,
		data: []
	};
	chartJsOptions.data.datasets[2] = {
		label: 'Sent (rtx)',
		fill: false,
		backgroundColor: 'orange',
		borderColor: 'orange',
		pointBackgroundColor: 'orange',
		pointBorderColor: 'orange',
		lineTension: 0,
		pointRadius: 0,
		data: []
	}
	chartJsOptions.data.datasets[3] = {
		label: 'Sent (probing)',
		fill: false,
		backgroundColor: 'green',
		borderColor: 'green',
		pointBackgroundColor: 'green',
		pointBorderColor: 'green',
		lineTension: 0,
		pointRadius: 0,
		data: []
	}
	chartJsOptions.data.datasets[4] = {
		label: 'Acked (all)',
		fill: false,
		backgroundColor: 'cyan',
		borderColor: 'cyan',
		pointBackgroundColor: 'cyan',
		pointBorderColor: 'cyan',
		lineTension: 0,
		pointRadius: 0,
		data: []
	};
	chartJsOptions.data.datasets[5] = {
		label: 'Acked (RTP)',
		fill: false,
		backgroundColor: 'magenta',
		borderColor: 'magenta',
		pointBackgroundColor: 'magenta',
		pointBorderColor: 'magenta',
		lineTension: 0,
		pointRadius: 0,
		data: []
	};
	chartJsOptions.data.datasets[6] = {
		label: 'Acked (rtx)',
		fill: false,
		backgroundColor: 'gold',
		borderColor: 'gold',
		pointBackgroundColor: 'gold',
		pointBorderColor: 'gold',
		lineTension: 0,
		pointRadius: 0,
		data: []
	}
	chartJsOptions.data.datasets[7] = {
		label: 'Acked (probing)',
		fill: false,
		backgroundColor: 'greengold',
		borderColor: 'greengold',
		pointBackgroundColor: 'greengold',
		pointBorderColor: 'greengold',
		lineTension: 0,
		pointRadius: 0,
		data: []
	}
	chartJsOptions.data.datasets[8] = {
		label: 'Estimate',
		fill: false,
		backgroundColor: 'red',
		borderColor: 'red',
		pointBackgroundColor: 'red',
		pointBorderColor: 'red',
		lineTension: 0,
		pointRadius: 0,
		data: []
	}
	chartJsOptions.data.datasets[9] = {
		label: 'Probing target',
		fill: false,
		backgroundColor: 'lightgrey',
		borderColor: 'lightgrey',
		pointBackgroundColor: 'lightgrey',
		pointBorderColor: 'lightgrey',
		lineTension: 0,
		pointRadius: 0,
		data: []
	}
	bitrates = new Chart(ctx, chartJsOptions);
	bitratesOpts = chartJsOptions;
}

function addBitrate(fb) {
	if(fb.time === '')
		return;
	bitratesOpts.data.labels.push(parseInt(fb.time / 1000));
	bitratesOpts.data.datasets[0].data.push(fb.bitrate_out);
	bitratesOpts.data.datasets[1].data.push(fb.bitrate_out - fb.rtx_out - fb.probing_out);
	bitratesOpts.data.datasets[2].data.push(fb.rtx_out);
	bitratesOpts.data.datasets[3].data.push(fb.probing_out);
	bitratesOpts.data.datasets[4].data.push(fb.bitrate_in);
	bitratesOpts.data.datasets[5].data.push(fb.bitrate_in - fb.rtx_in - fb.probing_in);
	bitratesOpts.data.datasets[6].data.push(fb.rtx_in);
	bitratesOpts.data.datasets[7].data.push(fb.probing_in);
	bitratesOpts.data.datasets[8].data.push(fb.estimate);
	bitratesOpts.data.datasets[9].data.push(fb.probing_target ? fb.probing_target : 0);
}

function drawDelays() {
	$('#graphs').append(
		'<div class="row" style="width:100%;">' +
		'	<button class="btn btn-danger btn-xs hide" id="unzoom1">Reset zoom</button>' +
		'</div>' +
		'<div class="row" style="width:100%;">' +
		'	<div class="well" style="width:100%;">' +
		'		<canvas id="canvas1"></canvas>' +
		'	</div>' +
		'</div>'
	);
	let ctx = document.getElementById('canvas1').getContext('2d');
	// Create chart.js graph
	let chartJsOptions = {
		type: 'line',
		data: {
			labels: [],
			datasets: []
		},
		options: {
			scales: {
				x: {
					type: 'time',
					time: {
						tooltipFormat: 'x',
						displayFormats: {
							'millisecond': 'x',
							'second': 'x',
							'minute': 'x',
							'hour': 'x',
							'day': 'x',
							'week': 'x',
							'month': 'x',
							'quarter': 'x',
							'year': 'x',
						}
					},
					title: {
						display: true,
						text: 'Time',
					},
				},
				y: {
					min: -6,
					max: 6,
					title: {
						display: true,
						text: 'ms'
					},
				}
			},
			plugins: {
				title: {
					display: true,
					text: 'Average delays'
				},
				tooltip: {
					mode: 'index',
					intersect: false,
				},
				zoom: {
					zoom: {
						enabled: true,
						drag: {
							enabled: true
						},
						mode: 'x',
						speed: 0.1,
						onZoomComplete: function(chart) {
							console.log('Delays zoomed');
							if(delays.getZoomLevel() === 1) {
								$('#unzoom').addClass('hide').unbind('click');
							} else {
								$('#unzoom').removeClass('hide').unbind('click').click(function() {
									bitrates.resetZoom();
									delays.resetZoom();
									$('#unzoom').addClass('hide').unbind('click');
								});
							}
							// Apply the same zoom to the other graph
							if(!bitratesZoomed) {
								console.log('Zooming bitrates too');
								bitrates.zoomScale('x', { min: delays.scales.x.min, max: delays.scales.x.max });
							}
							bitratesZoomed = false;
							delaysZoomed = false;
						}
					}
				}
			}
		},
	};
	chartJsOptions.data.datasets[0] = {
		label: 'BWE status',
		fill: false,
		backgroundColor: 'green',
		borderColor: 'green',
		pointBackgroundColor: 'green',
		pointBorderColor: 'green',
		lineTension: 0,
		pointRadius: 0,
		data: []
	};
	chartJsOptions.data.datasets[1] = {
		label: 'Average delay (weighted)',
		fill: false,
		backgroundColor: 'lightpink',
		borderColor: 'lightpink',
		pointBackgroundColor: 'lightpink',
		pointBorderColor: 'lightpink',
		lineTension: 0,
		pointRadius: 0,
		data: []
	};
	chartJsOptions.data.datasets[2] = {
		label: 'Average delay',
		fill: false,
		backgroundColor: 'gold',
		borderColor: 'gold',
		pointBackgroundColor: 'gold',
		pointBorderColor: 'gold',
		lineTension: 0,
		pointRadius: 0,
		data: []
	};
	chartJsOptions.data.datasets[3] = {
		label: 'Average delay (feedback)',
		fill: false,
		backgroundColor: 'brown',
		borderColor: 'brown',
		pointBackgroundColor: 'brown',
		pointBorderColor: 'brown',
		lineTension: 0,
		pointRadius: 0,
		data: []
	};
	delays = new Chart(ctx, chartJsOptions);
	delaysOpts = chartJsOptions;
}

function addDelay(fb) {
	if(fb.time === '')
		return;;
	delaysOpts.data.labels.push(parseInt(fb.time / 1000));
	if(isNaN(fb.status))
		delaysOpts.data.datasets[0].data.push(statuses.indexOf(fb.status));
	else
		delaysOpts.data.datasets[0].data.push(fb.status);
	delaysOpts.data.datasets[1].data.push(fb.avg_delay_weighted ? fb.avg_delay_weighted : 0.0);
	delaysOpts.data.datasets[2].data.push(fb.avg_delay);
	delaysOpts.data.datasets[3].data.push(0.0);
}
