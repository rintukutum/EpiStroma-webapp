const fs = require('fs');
var exec = require('child_process').exec;
var child_process = require('child_process');
var async = require('async');
var express = require('express');
var cors = require('cors');
var bodyParser = require('body-parser')
var app = express();
var nodeUtils = require('./server-utils/nodeUtils');
var configUtils = require('./server-utils/configUtils');
var edgeUtils = require('./server-utils/edgeUtils');
var styleUtils = require('./server-utils/styleUtils');
var geneUtils = require('./server-utils/geneUtils');
var layoutUtils = require('./server-utils/layoutUtils');
var authenticationUtils = require('./server-utils/authenticationUtils');
var validationUtils = require('./server-utils/validationUtils');
var clientTableUtils = require('./server-utils/clientTableUtils');
var parseUtils = require('./server-utils/parseUtils');
var multiparty = require('connect-multiparty');
var jwt = require('jsonwebtoken');
var databaseConfigUtils = require('./server-utils/databaseConfigUtils');
var fileUtils = require('./server-utils/fileUtils');
var bcrypt = require('bcrypt');
var jsonfile = require('jsonfile');
var mkdirp = require('mkdirp');

var fileUploadState = {
    single: -1,
    multipleCompleted: 3,
    failed: -20
};

app.get('', function(req, res) {
    res.redirect('/app');
});

app.use('/app', express.static(__dirname + '/app'));
app.set('secretKey', databaseConfigUtils.secret);
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

app.use(function(req, res, next) {
    if (req.body.token == null) {
        if (req.body.user == null) {
            res.send({ error: "Failed to authenticate." });
        } else {
            authenticationUtils.getUser(req.body.user.name,
                function(user) {
                    if (!user) {
                        res.json({ success: false, message: 'Authentication failed. User not found.' });
                    } else if (user) {
                        if (!bcrypt.compareSync(req.body.user.password, user.password)) {
                            res.json({ success: false, message: 'Authentication failed. Wrong password.' });
                        } else {
                            var token = jwt.sign({ user: Date.now() }, app.get('secretKey'), {
                                expiresIn: '168h' // expires in 7 days
                            });

                            authenticationUtils.addTokenToUser(user, token);

                            res.json({
                                success: true,
                                message: 'Enjoy your token!',
                                token: token
                            });
                        }

                    }

                });
        }
    } else if (req.body.token == 'guest') {
        next();
    } else {
        jwt.verify(req.body.token, app.get('secretKey'), function(err, decoded) {
            if (err) {
                console.log(err);
                return res.json({ success: false, message: 'Failed to authenticate token.' });
            } else {
                next();
            }
        });
    }
});

app.post('/get-user-permission', function(req, res) {
    var user = authenticationUtils.getUserFromToken(req.body.token);
    if (user == null) {
        res.send({ permission: 0 });
    } else {
        res.send({ permission: 1 });
    }
});

app.post('/login', function(req, res) {
    res.json({
        success: true,
        message: 'Token Validated!'
    });
});

app.post('/gene-list', function(req, res) {
    var args = { fileName: null };
    var argsString = "";
    var file;
    var user = authenticationUtils.getUserFromToken(req.body.token);
    //console.log(req.body);

    file = fileUtils.getRequestedFile(req.body.selectedFile, user);

    if (file == null || file.path == null || file.name == null) {
        res.send({ error: "Please specify a file name" });
        return;
    }

    var geneList = [];

    args.fileName = fileUtils.getCorrespondingDegreesFileName(file);
    args.path = file.path;

    argsString = JSON.stringify(args);
    argsString = argsString.replace(/"/g, '\\"');

    var child = exec("Rscript R_Scripts/getGeneList.R --args \"" + argsString + "\"", {
            maxBuffer: 1024 *
                50000
        },
        function(error, stdout, stderr) {
            //console.log('stdout: ' + stdout);
            console.log('stderr: ' + stderr);

            if (error != null) {
                console.log('error: ' + error);
            }

            var parsedValue = JSON.parse(stdout);
            var message = parsedValue.message;

            console.log("maxDegree: " + parsedValue.maxDegree);

            if (message) {
                res.json({ error: message });
                return;
            }

            var allGenes = [];

            var epiDegrees = parsedValue.epiDegrees;
            var stromaDegrees = parsedValue.stromaDegrees;

            var epiGeneNames = parsedValue.epiGeneNames;
            var stromaGeneNames = parsedValue.stromaGeneNames;

            var maxDegree = parsedValue.maxDegree;

            allGenes = allGenes.concat(geneUtils.createGeneList(epiGeneNames, epiDegrees));
            allGenes = allGenes.concat(geneUtils.createGeneList(stromaGeneNames, stromaDegrees));

            res.send({ geneList: allGenes, maxDegree: maxDegree });
        });
});

app.post('/min-degree-genes', function(req, res) {
    var args = {};
    var argsString = "";
    var file;
    var user = authenticationUtils.getUserFromToken(req.body.token);

    file = fileUtils.getRequestedFile(req.body.selectedFile, user);

    if (file == null || file.path == null || file.name == null) {
        res.send({ error: "Please specify a file name" });
        return;
    }

    args.fileName = fileUtils.getCorrespondingDegreesFileName(file);
    args.path = file.path;
    args.filterAmount = req.body.filterAmount;
    args.filterType = req.body.filterType;

    argsString = JSON.stringify(args);
    argsString = argsString.replace(/"/g, '\\"');

    var child = exec("Rscript R_Scripts/getMinDegreeGenes.R --args \"" + argsString + "\"", {
            maxBuffer: 1024 *
                50000
        },
        function(error, stdout, stderr) {
            //console.log('stdout: ' + stdout);
            console.log('stderr: ' + stderr);

            if (error != null) {
                console.log('error: ' + error);
            }

            var parsedValue = JSON.parse(stdout);
            var message = parsedValue.message;

            if (message) {
                res.json({ error: message });
                return;
            }

            var epiGenes = [];
            var stromaGenes = [];

            var epiDegrees = parsedValue.epiDegrees;
            var stromaDegrees = parsedValue.stromaDegrees;

            var epiGeneNames = parsedValue.epiGeneNames;
            var stromaGeneNames = parsedValue.stromaGeneNames;


            epiGenes = geneUtils.createGeneList(epiGeneNames, epiDegrees);
            stromaGenes = geneUtils.createGeneList(stromaGeneNames, stromaDegrees);

            res.send({ topGenes: { epi: epiGenes, stroma: stromaGenes } });
        });
});

app.post('/delta-interaction-explorer', function(req, res) {
    console.log("%j", req.body);
    var args = {};
    var argsString = "";
    var selectedGeneNames = [];
    var selectedGenes = req.body.selectedGenes;
    var requestedLayout = req.body.layout;
    var genesArg = "";
    var files = null;
    var user = authenticationUtils.getUserFromToken(req.body.token);

    files = fileUtils.getRequestedFiles(req.body.selectedFile, req.body.selectedNetworkType, user);

    var fileValidationres = validationUtils.validateFiles(files);
    if (fileValidationres.error) {
        res.send({ error: fileValidationres.error });
        return;
    }

    selectedGeneNames = validationUtils.validateSelectedGenes(selectedGenes);
    if (selectedGeneNames.error) {
        res.send({ error: selectedGeneNames.error });
        return;
    }

    args.selectedNetworkType = req.body.selectedNetworkType;
    args.selectedGenes = selectedGeneNames;
    args.fileNameMatrixNormal = files.normal;
    args.fileNameMatrixTumor = files.tumor;
    args.fileNameMatrixDelta = files.delta;
    args.fileNameDegrees = files.degree;
    argsString = JSON.stringify(args);
    argsString = argsString.replace(/"/g, '\\"');

    var child = exec("Rscript R_Scripts/deltaNeighbourExplorer.R --args \"" + argsString + "\"", { maxBuffer: 1024 * 50000 },
        function(error, stdout, stderr) {
            console.log('stderr: ' + stderr);

            if (error != null) {
                console.log('error: ' + error);
            }

            var initialColor = selectedGenes[0].value.endsWith("-E") ? "red" : "blue";

            var parsedValue = JSON.parse(stdout);
            var message = parsedValue.message;

            if (message) {
                res.json({ error: message });
                return;
            }

            var parsedNodes = parsedValue.nodes
            var parsedEdges = parsedValue.edges;

            var allNodes = [];
            var interactionsTableList = [];
            var sourceNodes = [];
            var nodes = [];
            var parentNodes = [];
            var edges = [];
            var elements = [];
            var config = configUtils.createConfig();
            var layout = null;
            var edgeDictionary = {};
            var edgeStyleNegative = JSON.parse(JSON.stringify(styleUtils.edgeWeights.negative));
            var edgeStylePositive = JSON.parse(JSON.stringify(styleUtils.edgeWeights.positive));

            var overallWeights = parseUtils.parseMinMaxWeights(parsedValue.minMaxWeightOverall);
            edgeStyleNegative = styleUtils.setDynamicEdgeStyles(edgeStyleNegative, { min: overallWeights.minNegative, max: overallWeights.maxNegative });
            edgeStylePositive = styleUtils.setDynamicEdgeStyles(edgeStylePositive, { min: overallWeights.minPositive, max: overallWeights.maxPositive });

            sourceNodes.push(nodeUtils.createNodes([selectedGenes[0].value], 'par' + 0, selectedGenes[0].object.degree, -1));

            for (var i = 0; i < parsedEdges.length; i++) {
                edges = edges.concat(edgeUtils.createEdgesFromREdges(parsedEdges[i], i + 1));
            }

            for (var i = 0; i < parsedNodes.length; i++) {
                nodes.push(nodeUtils.createNodesFromRNodes(parsedNodes[i]));
            }

            allNodes = nodes.concat(sourceNodes);

            if (requestedLayout == 'bipartite' || requestedLayout == 'preset') {
                var maxRows = 1;
                var maxCols = allNodes.length + 1;
                allNodes = nodeUtils.positionNodesBipartiteGrid(allNodes);

                for (var j = 0; j < allNodes.length; j++) {
                    if (allNodes[j].length > maxRows) {
                        maxRows = allNodes[j].length;
                    }
                }

                layout = layoutUtils.createGridLayout(maxRows, maxCols);

                config = configUtils.addStylesToConfig(config, styleUtils.getAllBipartiteStyles());
                config = configUtils.addStyleToConfig(config, styleUtils.nodeSize.medium);
                config = configUtils.setConfigLayout(config, layout);

                parentNodes = nodeUtils.createParentNodesIE(selectedGenes, nodes);
                elements = elements.concat(parentNodes);
            } else {
                for (var i = 0; i < nodes.length; i++) {
                    for (var j = 0; j < nodes[i].length; j++) {
                        if (nodes[i][j].data.isSource) {
                            nodeUtils.addClassToNodes(nodes[i][j], "sourceNode");
                        }
                    }
                }

                config = configUtils.createConfig();
                layout = layoutUtils.createRandomLayout([].concat.apply([], nodes).length, styleUtils.nodeSizes.medium);

                nodes = nodeUtils.addClassToNodes(sourceNodes[0], "sourceNode");
                config = configUtils.addStylesToConfig(config, styleUtils.allRandomFormats);
                config = configUtils.setConfigLayout(config, layout);
            }

            elements = elements.concat([].concat.apply([], allNodes));
            elements = elements.concat(edges);
            // elements.push(sourceNodes[0][0]);

            config = configUtils.addStyleToConfig(config, edgeStyleNegative);
            config = configUtils.addStyleToConfig(config, edgeStylePositive);
            config = configUtils.setConfigElements(config, elements);

            selfLoops = clientTableUtils.getSelfLoops(edges);
            edgeDictionary = clientTableUtils.createEdgeDictionaryFromREdges([].concat.apply([], parsedEdges));

            res.json({
                config: config,
                selfLoops: selfLoops,
                edgeDictionary: edgeDictionary
            });
        });
});

app.post('/delta-submatrix', function(req, res) {
    // console.log("%j", req.body);
    var args = {};
    var argsString = "";
    var files = null;
    var selectedGeneNames = [];
    var selectedGenes = req.body.selectedGenes;
    var requestedLayout = req.body.layout;
    var filterValidationRes = validationUtils.validateFilters(req.body);
    var user = authenticationUtils.getUserFromToken(req.body.token);

    files = fileUtils.getRequestedFiles(req.body.selectedFile, req.body.selectedNetworkType, user);

    if (filterValidationRes.error) {
        res.send(filterValidationRes);
        return;
    }

    var fileValidationres = validationUtils.validateFiles(files);
    if (fileValidationres.error) {
        res.send({ error: fileValidationres.error });
        return;
    }

    selectedGeneNames = validationUtils.validateSelectedGenes(selectedGenes);
    if (selectedGeneNames.error) {
        res.send({ error: selectedGeneNames.error });
        return;
    }

    args.selectedNetworkType = req.body.selectedNetworkType;
    args.fileNameMatrixNormal = files.normal;
    args.fileNameMatrixTumor = files.tumor;
    args.fileNameMatrixDelta = files.delta;
    args.fileNameDegrees = files.degree;
    args.minPositiveWeightFirst = req.body.minPositiveWeightFirst;
    args.minNegativeWeightFirst = req.body.minNegativeWeightFirst;
    args.minPositiveWeightSecond = req.body.minPositiveWeightSecond;
    args.minNegativeWeightSecond = req.body.minNegativeWeightSecond;
    args.weightFilterFirst = req.body.filterFirst;
    args.weightFilterSecond = req.body.filterSecond;
    args.depth = req.body.depth;

    args.genesOfInterest = selectedGeneNames;
    argsString = JSON.stringify(args);
    argsString = argsString.replace(/"/g, '\\"');

    var child = exec("Rscript R_Scripts/deltaSubmatrix.R --args \"" + argsString + "\"", {
            maxBuffer: 1024 *
                50000
        },
        function(error, stdout, stderr) {
            console.log('stderr: ' + stderr);

            if (error != null) {
                console.log('error: ' + error);
            }

            var parsedValue = JSON.parse(stdout);
            var message = parsedValue.message;

            if (message) {
                res.json({ error: message });
                return;
            }

            var parsedNodesFirst = parsedValue.neighboursNodes.first;
            var parsedNodesSecond = parsedValue.neighboursNodes.second;

            var parsedEdgesFirst = parsedValue.edges.first;
            var parsedEdgesSecond = parsedValue.edges.second;
            var parsedEdgesAll = parsedEdgesFirst.concat(parsedEdgesSecond);

            var sourceNodes = [];
            var firstNodes = [];
            var secondNodes = [];
            var parentNodes = [];
            var allNodes = [];
            var edges = [];
            var cytoscapeEdges = [];
            var firstNeighbourInteractions = [];
            var secondNeighbourInteractions = [];
            var edgeDictionary = {};
            var selfLoops = [];
            var elements = [];
            var config = null;
            var layout = null;
            var edgeStyleNegative = JSON.parse(JSON.stringify(styleUtils.edgeWeights.negative));
            var edgeStylePositive = JSON.parse(JSON.stringify(styleUtils.edgeWeights.positive));

            var overallWeights = parseUtils.parseMinMaxWeights(parsedValue.minMaxWeightOverall);
            var depthWeights = parseUtils.parseMinMaxWeights(parsedValue.minMaxWeightDepth);

            edgeStyleNegative = styleUtils.setDynamicEdgeStyles(edgeStyleNegative, { min: overallWeights.minNegative, max: overallWeights.maxNegative });
            edgeStylePositive = styleUtils.setDynamicEdgeStyles(edgeStylePositive, { min: overallWeights.minPositive, max: overallWeights.maxPositive });

            for (var i = 0; i < selectedGenes.length; i++) {
                sourceNodes.push(nodeUtils.createNodes([selectedGenes[i].object.name], 'par' + 0, selectedGenes[i].object.degree, -1));
            }

            for (var i = 0; i < parsedNodesFirst.length; i++) {
                firstNodes[i] = nodeUtils.createNodesFromRNodes(parsedNodesFirst[i]);
            }

            for (var i = 0; i < parsedNodesSecond.length; i++) {
                secondNodes[i] = nodeUtils.createNodesFromRNodes(parsedNodesSecond[i]);
            }

            for (var i = 0; i < parsedEdgesFirst.length; i++) {
                cytoscapeEdges = cytoscapeEdges.concat(edgeUtils.createEdgesFromREdges(parsedEdgesFirst[i], 1));
            }

            firstNeighbourInteractions = cytoscapeEdges;
            cytoscapeEdges = [];

            for (var i = 0; i < parsedEdgesSecond.length; i++) {
                cytoscapeEdges = cytoscapeEdges.concat(edgeUtils.createEdgesFromREdges(parsedEdgesSecond[i], 2));
            }

            secondNeighbourInteractions = cytoscapeEdges;

            edges = edges.concat(firstNeighbourInteractions);
            edges = edges.concat(secondNeighbourInteractions);

            elements = elements.concat(edges);
            config = configUtils.createConfig();

            if (requestedLayout == 'bipartite' || requestedLayout == 'preset') {
                var maxRows = 1;
                var maxCols = 3;
                allNodes = [parseUtils.flatten(sourceNodes)].concat([parseUtils.flatten(firstNodes)]).concat([parseUtils.flatten(secondNodes)]);

                for (var j = 0; j < allNodes.length; j++) {
                    if (allNodes[j].length > maxRows) {
                        maxRows = allNodes[j].length;
                    }
                }

                allNodes = nodeUtils.positionNodesBipartiteGrid(allNodes);
                layout = layoutUtils.createGridLayout(maxRows, maxCols);

                config = configUtils.addStylesToConfig(config, styleUtils.getAllBipartiteStyles());
                config = configUtils.addStyleToConfig(config, styleUtils.nodeSize.medium);

                parentNodes = nodeUtils.createParentNodesMG(nodeUtils.isNodesArrayFull(sourceNodes) +
                    nodeUtils.isNodesArrayFull(firstNodes) + nodeUtils.isNodesArrayFull(secondNodes));
                allNodes.push(parentNodes);
                allNodes = parseUtils.flatten(allNodes);
            } else if (requestedLayout == 'clustered') {
                var largestClusterSize = 0;
                sourceNodes = nodeUtils.addClassToNodes(parseUtils.flatten(sourceNodes), "sourceNode");

                for (var i = 0; i < sourceNodes.length; i++) {
                    var clusterSize = nodeUtils.getMinRadius(firstNodes[i] == null ? 0 : firstNodes[i].length, styleUtils.nodeSizes.medium / 2) + nodeUtils.getMinRadius(secondNodes[i] == null ? 0 : secondNodes[i].length, styleUtils.nodeSizes.medium / 2);

                    if (clusterSize > largestClusterSize) {
                        largestClusterSize = clusterSize;
                    }
                }

                var temp;

                for (var i = 0; i < sourceNodes.length; i++) {
                    temp = nodeUtils.positionNodesClustered(sourceNodes[i], firstNodes[i] == null ? [] : firstNodes[i], secondNodes[i] == null ? [] : secondNodes[i], i, sourceNodes.length, styleUtils.nodeSizes.medium / 2, largestClusterSize);

                    if (firstNodes[i] != null) {
                        firstNodes[i] = temp.firstNeighbours;
                    }

                    if (secondNodes[i] != null) {
                        secondNodes[i] = temp.secondNeighbours;
                    }

                    sourceNodes[i] = temp.selectedGene;
                }

                layout = layoutUtils.createPresetLayout();
                config = configUtils.addStylesToConfig(config, styleUtils.allConcentricFormats);

                allNodes = sourceNodes.concat(firstNodes).concat(secondNodes);
                allNodes = parseUtils.flatten(allNodes);
            } else {
                sourceNodes = nodeUtils.addClassToNodes(parseUtils.flatten(sourceNodes), "sourceNode");
                allNodes = sourceNodes.concat(firstNodes).concat(secondNodes);
                allNodes = parseUtils.flatten(allNodes);
                layout = layoutUtils.createRandomLayout(allNodes.length, styleUtils.nodeSizes.medium);
                config = configUtils.addStylesToConfig(config, styleUtils.allRandomFormats);
            }


            config = configUtils.setConfigLayout(config, layout);
            config = configUtils.addStyleToConfig(config, edgeStyleNegative);
            config = configUtils.addStyleToConfig(config, edgeStylePositive);
            config = configUtils.setConfigElements(config, edges.concat(allNodes));

            edgeDictionary = clientTableUtils.createEdgeDictionaryFromREdges([].concat.apply([], parsedEdgesAll));
            selfLoops = clientTableUtils.getSelfLoops(edges);

            res.json({
                config: config,
                minNegativeWeight: depthWeights.minNegative,
                maxPositiveWeight: depthWeights.maxPositive,
                firstNeighbours: firstNodes,
                secondNeighbours: secondNodes,
                edgeDictionary: edgeDictionary,
                selfLoops: selfLoops
            });
        });
});

app.post('/delta-get-all-paths', function(req, res) {
    var args = {};
    var argsString = "";
    var source = req.body.source;
    var target = req.body.target;
    var files = null;
    var user = authenticationUtils.getUserFromToken(req.body.token);

    files = fileUtils.getRequestedFiles(req.body.selectedFile, req.body.selectedNetworkType, user);

    if (files == null) {
        res.send({ error: "Please specify the necessary files." });
        return;
    } else if (files.error != null) {
        res.send({ error: files.error });
        return;
    }

    args.selectedNetworkType = req.body.selectedNetworkType;
    args.fileNameMatrixNormal = files.normal;
    args.fileNameMatrixTumor = files.tumor;
    args.fileNameMatrixDelta = files.delta;

    args.source = source;
    args.target = target;

    argsString = JSON.stringify(args);
    argsString = argsString.replace(/"/g, '\\"');

    var child = exec("Rscript R_Scripts/deltaGetAllPaths.R --args \"" + argsString + "\"", {
        maxBuffer: 1024 *
            50000
    }, function(error, stdout, stderr) {
        if (error != null) {
            console.log('error: ' + error);
        }

        if (stderr != null) {
            console.log(stderr);
        }

        var parsedValue = JSON.parse(stdout);
        var message = parsedValue.message;

        if (message) {
            res.json({ error: message });
            return;
        }

        var paths = parsedValue.paths;
        var types = ["weight"];

        if (req.body.selectedNetworkType == 'delta') {
            types.push('normal');
            types.push('tumor');
        }

        res.send({ paths: paths, types: types });
    });

});

app.post('/available-matrices', function(req, res) {
    var subTypes = req.body.types;
    var user = authenticationUtils.getUserFromToken(req.body.token);
    var accessibleMatrices = fileUtils.getAccessibleMatricesForUser(user);

    console.log("getting available-matrices for user: %j", user);

    res.send({ fileList: accessibleMatrices });
});

app.post('/overall-matrix-stats', function(req, res) {
    var args = {};
    var file;
    var user = authenticationUtils.getUserFromToken(req.body.token);

    file = fileUtils.getRequestedFile(req.body.selectedFile, user);

    if (file == null || file.path == null || file.name == null) {
        res.send({ error: "Please specify a file name" });
        return;
    }

    args.fileName = file.name;
    args.path = file.path;
    argsString = JSON.stringify(args);
    argsString = argsString.replace(/"/g, '\\"');

    var child = exec("Rscript R_Scripts/getOverallMatrixStats.R  --args \"" + argsString + "\"", {
            maxBuffer: 1024 *
                50000
        },
        function(error, stdout, stderr) {
            console.log('stderr: ' + stderr);

            if (error != null) {
                console.log('error: ' + error);
            }

            var overallMatrixStats = {};
            var parsedValue = JSON.parse(stdout);

            overallMatrixStats.selfLoops = parsedValue.selfLoops;
            overallMatrixStats.significantInteractions = parsedValue.significantInteractions;
            res.send({ overallMatrixStats: overallMatrixStats });
        });
});

app.post('/delete-file', function(req, res) {
    var user = authenticationUtils.getUserFromToken(req.body.token);
    var file;
    console.log("delete file: %j", req.body.file);

    file = fileUtils.getRequestedFile({ arbitrary: req.body.file }, user)
    if (file == null) {
        res.send({ fileStatus: "!!!!Failed to delete file: " })
        return;
    }

    if (file) {
        async.series([
                function(callback) {
                    fileUtils.removeFile(file.path, file, callback);
                }
            ],
            // optional callback
            function(err, results) {
                console.log("results in server.js: %j", results);
                console.log("err: %j", err);
                fileUtils.updateAvailableMatrixCache();

                if (results != null && results.length > 0 && results[0] != null) {
                    res.send({ fileStatus: "Failed to delete file: " + file.name });
                } else {
                    res.send({ fileStatus: "Successfully deleted file" });
                }
            });
    }
});

app.post('/upload-matrix', function(req, res) {
    var user = authenticationUtils.getUserFromToken(req.body.token);
    var files = req.body.files;
    var uploadType = req.body.type;

    if (user == null) {
        console.log("Unable to find user for token: " + req.body.token);
        res.send({ error: "Unable to find user for specified token" });
        return;
    }

    if (uploadType == 'delta' && (files.delta == null || files.normal == null || files.tumor == null)) {
        res.send({ error: "Not enough files specified for delta network" });
        return;
    } else if (uploadType != 'delta' && uploadType != 'tumor' && uploadType != 'normal') {
        res.send({ error: "Incorrect upload type specified" });
        return;
    }

    var nonEmptyFiles = [];

    for (var prop in files) {
        if (files[prop] != null) {
            if (typeof files[prop].name == 'string') {
                if (!files[prop].name.toLowerCase().endsWith('.rdata')) {
                    res.send({ error: "File upload failed. Please specify an Rdata file instead of: " + files[prop].name });
                    return;
                } else if (files[prop].name.startsWith("degree")) {
                    res.send({ error: "File upload failed. Please change the file name so that it doesn't contain 'degree' in it. File name: " + files[prop].name });
                    return;
                }
            } else {
                res.send({ error: "File upload failed. Could not determine name of uploaded file(s)" })
                return;
            }
            nonEmptyFiles.push(prop);
        }
    }

    async.eachSeries(nonEmptyFiles, function iteratee(type, callback) {
        console.log(files[type].name);
        files[type].data = files[type].data.replace(/^data:;base64,/, "");
        fileUtils.createDirectory(fileUtils.BASE_UPLOAD_DIRECTORY, user.name, type, callback);
        fileUtils.writeFile(fileUtils.BASE_UPLOAD_DIRECTORY, files[type], user.name, type, callback);

    }, function done() {
        console.log("Finished writing files");
    });

    async.eachSeries(nonEmptyFiles, function iteratee(type, callback) {
        console.log("type:" + type);
        verifyFile(fileUtils.BASE_UPLOAD_DIRECTORY + user.name + "/" + type + "/", files[type].name, callback);
    }, function done(result) {
        if (result != null) {
            for (var i = 0; i < nonEmptyFiles.length; i++) {
                fileUtils.removeFile(fileUtils.BASE_UPLOAD_DIRECTORY + user.name + "/" + nonEmptyFiles[i] + "/", files[nonEmptyFiles[i]], null);
            }

            fileUtils.updateAvailableMatrixCache();
            res.send({ fileStatus: "Failed to upload file(s). " + result.message, errorStatus: result.status })
        } else {
            fileUtils.updateAvailableMatrixCache();
            res.send({ fileStatus: "Successfully uploaded file(s). Please check the dropdown to select new file(s). " })
        }

        console.log("Finished verifying files");
    });
});

function verifyFile(filePath, fileName, callback) {
    var args = {};
    var argsString = "";

    args.filePath = filePath;
    args.fileName = fileName

    argsString = JSON.stringify(args);
    argsString = argsString.replace(/"/g, '\\"');

    var child = exec("Rscript R_Scripts/fileChecker.R --args \"" + argsString + "\"", function(error, stdout, stderr) {
        console.log('stderr: ' + stderr);

        if (error != null) {
            console.log('error: ' + error);
        }
        //console.log(stdout);

        var parsedValue = JSON.parse(stdout);
        var status = parsedValue.status;
        var message = parsedValue.message;

        if (status > 0) {
            callback({ status: status, message: message });
        } else {
            callback();
        }
    });
}

function createSampleUser() {
    var salt = bcrypt.genSaltSync(3);
    var password = bcrypt.hashSync('', salt);
    var nick = new User({
        name: '',
        password: password,
        admin: true
    });

    // save the sample user
    nick.save(function(err) {
        if (err) throw err;

        console.log('User saved successfully');
        // res.json({ success: true });
    });
}

var server = app.listen(5000, function() {
    console.log("Listening on port 5000");
    console.log("Initializing data and config");

    // var salt = bcrypt.genSaltSync(3);
    // var password = bcrypt.hashSync('', salt);
    // console.log("password: " + password);

    fileUtils.updateAvailableMatrixCache();
    //createSampleUser();
});

server.timeout = 300000;
