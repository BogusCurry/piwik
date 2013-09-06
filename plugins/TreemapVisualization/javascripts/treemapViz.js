/*!
 * Piwik - Web Analytics
 *
 * @link http://piwik.org
 * @license http://www.gnu.org/licenses/gpl-3.0.html GPL v3 or later
 */

(function ($, $jit, require) {

    var dataTable = window.dataTable,
        dataTablePrototype = dataTable.prototype;

    /**
     * Class that handles UI behavior for the treemap visualization.
     */
    window.TreemapDataTable = function () {
        dataTable.call(this);
    };

    $.extend(window.TreemapDataTable.prototype, dataTablePrototype, {

        /**
         * Constructor.
         * 
         * @param {String} workingDivId The HTML ID of the data table DOM element.
         * @param {Element} [domElem] The DOM element of the data table.
         */
        init: function (workingDivId, domElem) {
            if (typeof domElem == "undefined") {
                domElem = $('#' + workingDivId);
            }

            dataTablePrototype.init.call(this, workingDivId, domElem);

            var treemapContainerId = this.workingDivId + '-infoviz-treemap';
            var treemapContainer = $('.infoviz-treemap', domElem).attr('id', treemapContainerId);

            if (!treemapContainer[0]) {
                return;
            }

            var self = this;
            this.treemap = new $jit.TM.Squarified({
                injectInto: treemapContainerId,
                titleHeight: 24,
                animate: true, // TODO: disable on ipad/w/o native canvas support
                offset: 1,
                levelsToShow: (self.props.depth || 1) + 1,
                constrained: true,
                Events: {
                    enable: true,
                    onClick: function (node, info, event) {
                        if (event.which == 2) {
                            self._onMiddleClick(node);
                        } else {
                            self._onLeftClickNode(node);
                        }
                    },
                    onRightClick: function (node) {
                        self._onRightClickNode(node);
                    }
                },
                duration: 1000,
                Tips: {
                    enable: false // TODO: show more in tooltips
                },
                onCreateLabel: function (nodeElement, node) {
                    self._initNode(nodeElement, node);
                },
                onPlaceLabel: function (nodeElement, node) {
                    self._toggleLabelBasedOnAvailableSpace(nodeElement, node);
                }
            });

            this.data = this._prepareTreemapData(treemapContainer.attr('data-data'));
            this._refreshTreemap({animate: true});
            this._addSeriesPicker(domElem);
        },

        /**
         * Recursively iterates over the entire data tree and executes a function with
         * each node.
         * 
         * @param {Function} f The function to execute. Accepts one argument, the node.
         * @param {Object} [node] The JSON node object to start from. This defaults to the root
         *                        of the entire tree.
         */
        foreachNode: function (f, node) {
            node = node || this.data;

            f(node);
            for (var i = 0; i != (node.children || []).length; ++i) {
                this.foreachNode(f, node.children[i]);
            }
        },

        /**
         * Changes the metric the treemap displays.
         * 
         * @param {String} metric The name of the metric, e.g. 'nb_visits', 'nb_actions', etc.
         */
        changeMetric: function (metric) {
            this.param.columns = metric;
            this.reloadAjaxDataTable();
        },

        /**
         * Adds the SeriesPicker DataTable visualization widget to this treemap visualization.
         */
        _addSeriesPicker: function (dataTableDomElem) {
            var self = this;
            var SeriesPicker = require('piwik/DataTableVisualizations/Widgets').SeriesPicker;

            this._seriesPicker = new SeriesPicker(this);

            $(this._seriesPicker).bind('placeSeriesPicker', function () {
                var displayedColumn = this.getMetricTranslation(self.param.columns);

                var metricLabel = $('<span/>')
                    .addClass('infoviz-treemap-colors')
                    .attr('data-name', 'header-color')
                    .text("— " + displayedColumn)
                    ;

                var seriesPickerContainer = $('<div/>') // TODO: this behavior should probably be a part of SeriesPicker
                    .addClass('infoviz-treemap-series-picker')
                    .append(metricLabel)
                    .append(this.domElem)
                    ;

                dataTableDomElem.prepend(seriesPickerContainer);
            });

            $(this._seriesPicker).bind('seriesPicked', function (e, columns) {
                self.changeMetric(columns[0]);
            });

            this._seriesPicker.init();
        },

        /**
         * Initializes the display of a treemap node element.
         */
        _initNode: function (nodeElement, node) {
            var $nodeElement = $(nodeElement),
                nodeHasUrl = node.data.metadata && node.data.metadata.url,
                nodeHasLogo = node.data.metadata && node.data.metadata.logo;

            // add label (w/ logo if it exists)
            var $label = $('<div></div>').addClass("infoviz-treemap-node-label");
            $label.append($('<span></span>').text(node.name));

            var leftImage = null;
            if (nodeHasLogo) {
                leftImage = node.data.metadata.logo;
            } else if (nodeHasUrl) {
                leftImage = 'plugins/Zeitgeist/images/link.gif';
            }

            if (leftImage) {
                $label.prepend($('<img></img>').attr('src', leftImage));
            }

            $nodeElement.append($label);

            // set node tooltip
            if (nodeHasUrl) {
                var tooltip = node.data.metadata.url;
            } else {
                var tooltip = node.name;
            }
            if (node.data.metadata
                && node.data.metadata.tooltip
            ) {
                tooltip += ' ' + node.data.metadata.tooltip;
            }
            $nodeElement.attr('title', tooltip);

            // set label color
            if (this.labelColor) {
                $label.css('color', this.labelColor);
            }

            // if the node can be clicked into, show a pointer cursor over it
            if (this._canEnterNode(node)
                || nodeHasUrl
            ) {
                $nodeElement.addClass("infoviz-treemap-enterable-node");
            }
        },

        /**
         * Shows/hides the label depending on whether there's enough vertical space in the node
         * to show it.
         */
        _toggleLabelBasedOnAvailableSpace: function (nodeElement, node) {
            var $nodeElement = $(nodeElement),
                $label = $nodeElement.children('span');
            $label.toggle($nodeElement.height() > $label.height());
        },

        /**
         * Prepares data obtained from Piwik server-side code to be used w/ the JIT Treemap
         * visualization. Will make sure each node ID is unique and has a color.
         */
        _prepareTreemapData: function (data) {
            if (typeof data == 'string') {
                data = JSON.parse(data);
            }

            this._prependDataTableIdToNodeIds(this.workingDivId, data);
            this._setTreemapColors(data);
            return data;
        },

        /**
         * Reloads the treemap visualization using this.data.
         */
        _refreshTreemap: function (options) {
            if (!options.animate) {
                this.treemap.config.animate = false;
            }

            this.treemap.loadJSON(this.data);
            this.treemap.refresh();

            if (!options.animate) {
                this.treemap.config.animate = true;
            }
        },

        /**
         * Alters the ID of each node in tree so it will be unique even if more than one treemap
         * is displayed.
         */
        _prependDataTableIdToNodeIds: function (idPrefix, tree) {
            tree.id = idPrefix + '-' + tree.id;

            var children = tree.children || [];
            for (var i = 0; i != children.length; ++i) {
                this._prependDataTableIdToNodeIds(idPrefix, children[i]);
            }
        },

        /**
         * Sets the color of each treemap node.
         */
        _setTreemapColors: function (root) {
            if (this.props.show_evolution_values) {
                this._setTreemapColorsFromEvolution(root);
            } else {
                this._setTreemapColorsNormal(root);
            }
        },

        _setTreemapColorsFromEvolution: function (root) {
            // get colors
            var colorManager = piwik.ColorManager;
            var colorNames = ['no-change', 'negative-change-max', 'positive-change-max', 'label'];
            var colors = colorManager.getColors('infoviz-treemap-evolution-colors', colorNames);

            // find min-max evolution values to make colors relative to
            var minEvolution = -100, maxEvolution = 100;
            this.foreachNode(function (node) {
                var evolution = node.data.evolution || 0;

                if (evolution < 0) {
                    minEvolution = Math.min(minEvolution, evolution);
                } else if (evolution > 0) {
                    maxEvolution = Math.max(maxEvolution, evolution);
                }
            }, root);

            // color each node
            var self = this,
                negativeChangeColor = colorManager.getRgb(colors['negative-change-max'] || '#f00'),
                positiveChangeColor = colorManager.getRgb(colors['positive-change-max'] || '#0f0'),
                noChangeColor = colorManager.getRgb(colors['no-change'] || '#333');

            this.foreachNode(function (node) {
                var evolution = node.data.evolution || 0;

                var color;
                if (evolution < 0) {
                    var colorPercent = (minEvolution - evolution) / minEvolution;
                    color = colorManager.getSingleColorFromGradient(negativeChangeColor, noChangeColor, colorPercent);
                } else if (evolution > 0) {
                    var colorPercent = (maxEvolution - evolution) / maxEvolution;
                    color = colorManager.getSingleColorFromGradient(positiveChangeColor, noChangeColor, colorPercent);
                } else {
                    color = colors['no-change'];
                }

                node.data.$color = color;
            }, root);

            this.labelColor = colors.label;
        },

        /**
         * Sets the color of treemap nodes using pie-graph-colors.
         */
        _setTreemapColorsNormal: function (root) {
            var seriesColorNames = ['series1', 'series2', 'series3', 'series4', 'series5',
                                    'series6', 'series7', 'series8', 'series9', 'series10'];
            var colors = piwik.ColorManager.getColors('pie-graph-colors', seriesColorNames, true);

            var colorIdx = 0;
            this.foreachNode(function (node) {
                node.data.$color = colors[colorIdx];
                colorIdx = (colorIdx + 1) % colors.length;
            });
        },

        /**
         * Event handler for when a node is left-clicked.
         * 
         * This function will enter the node if it can be entered. If it can't be entered, we try
         * and open the node's associated URL, if it has one.
         */
        _onLeftClickNode: function (node) {
            if (!node) {
                return;
            }

            if (this._isOthersNode(node)) {
                this._enterOthersNode(node);
            } else if (this._nodeHasSubtable(node)) {
                this._enterSubtable(node);
            } else {
                this._openNodeUrl(node);
            }
        },

        /**
         * Event handler for when a node is middle clicked.
         * 
         * If the node has a url, this function will load the URL in a new tab/window.
         */
        _onMiddleClick: function (node) {
            if (!node) {
                return;
            }

            this._openNodeUrl(node);
        },

        /**
         * If the given node has an associated URL, it is opened in a new tab/window.
         */
        _openNodeUrl: function (node) {
            if (node.data.metadata
                && node.data.metadata.url
            ) {
                window.open(node.data.metadata.url, '_blank');
            }
        },

        /**
         * Event handler for when a node is right clicked.
         * 
         * This function will advance to the parent of the current node, if it has one.
         */
        _onRightClickNode: function (node) {
            this.treemap.out();
        },

        /**
         * Enters a treemap node that is a node for an aggregate row.
         */
        _enterOthersNode: function (node) {
            if (node.data.loading) {
                return;
            }

            if (!node.data.loaded) {
                var self = this;
                this._loadOthersNodeChildren(node, function (newNode) {
                    self.treemap.enter(newNode);
                });
            } else {
                this.treemap.enter(node);
            }
        },

        /**
         * Enter a treemap node that is a node for a row w/ a subtable.
         */
        _enterSubtable: function (node) {
            if (node.data.loading) {
                return;
            }

            if (!node.data.loaded) {
                var self = this;
                this._loadSubtableNodeChildren(node, function (newNode) {
                    self.treemap.enter(newNode);
                });
            } else {
                this.treemap.enter(node);
            }
        },

        /**
         * Loads data for an aggregate row's node without reloading the datatable view.
         */
        _loadOthersNodeChildren: function (node, callback) {
            var ajax = this._getNodeChildrenAjax({filter_offset: node.data.aggregate_offset}, node, callback);
            ajax.send();
        },

        /**
         * Loads data for a node's subtable without reloading the datatable view.
         */
        _loadSubtableNodeChildren: function (node, callback) {
            var ajax = this._getNodeChildrenAjax({idSubtable: node.data.idSubtable}, node, callback);
            ajax.send();
        },

        /**
         * Loads a node's children via AJAX and updates w/o reloading the datatable view.
         */
        _getNodeChildrenAjax: function (overrideParams, node, callback) {
            var self = this,
                dataNode = this._findNodeWithId(node.id),
                params = $.extend({}, this.param, overrideParams, {
                    module: 'API',
                    method: 'TreemapVisualization.getTreemapData',
                    action: 'index',
                    apiMethod: this.param.module + '.' + this.param.action, // TODO: will this work for all subtables?
                    format: 'json',
                    column: this.param.columns,
                    truncateAfter: this.props.max_graph_elements - 1,
                    filter_limit: -1,
                    expanded: 1,
                    depth: this.props.depth || 1,
                    show_evolution_values: this.props.show_evolution_values || 0
                });

            // make sure parallel load data requests aren't made
            node.data.loading = dataNode.data.loading = true;

            var ajax = new ajaxHelper();
            ajax.addParams(params, 'get');
            ajax.setLoadingElement('#' + self.workingDivId + ' .loadingPiwikBelow');
            ajax.setCallback(function (response) {
                dataNode.data.loaded = true;
                delete dataNode.data.loading;

                var repsonse = self._prepareTreemapData(response);
                dataNode.children = response.children;

                self._refreshTreemap({animate: false});

                callback(self.treemap.graph.getNode(node.id));
            });
            ajax.setFormat('json');
            return ajax;
        },

        /**
         * Returns true if the given node is the node of an aggregate row, false if otherwise.
         */
        _isOthersNode: function (node) {
            return this._getRowIdFromNode(node) == -1;
        },

        /**
         * Returns true if the given node has a subtable, false if otherwise.
         */
        _nodeHasSubtable: function (node) {
            return !! node.data.idSubtable;
        },

        /**
         * Returns true if the given node can be entered, false if otherwise.
         * 
         * A node can be entered if it is the node for an aggregate row or has a subtable.
         */
        _canEnterNode: function (node) {
            return this._isOthersNode(node) || this._nodeHasSubtable(node);
        },

        /**
         * Returns the ID of the DataTable row associated with a node.
         */
        _getRowIdFromNode: function (node) {
            return node.id.substring(node.id.lastIndexOf('_') + 1);
        },

        /**
         * Find node in the JSON data used to initialize the Treemap by its ID.
         */
        _findNodeWithId: function (id, node) {
            if (!node) {
                node = this.data;
            }

            if (node.id == id) {
                return node;
            }

            for (var i = 0; i != node.children.length; ++i) {
                var result = this._findNodeWithId(id, node.children[i]);
                if (result) {
                    return result;
                }
            }
        }
    });

}(jQuery, $jit, require));