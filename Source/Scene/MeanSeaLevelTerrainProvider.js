/*global define*/
define([
        '../Core/Math',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/DeveloperError',
        '../Core/Ellipsoid',
        '../Core/Event',
        '../Core/loadArrayBuffer',
        './HeightmapTerrainData',
        './TerrainProvider',
        './GeographicTilingScheme'
    ], function(
        CesiumMath,
        defaultValue,
        defined,
        defineProperties,
        DeveloperError,
        Ellipsoid,
        Event,
        loadArrayBuffer,
        HeightmapTerrainData,
        TerrainProvider,
        GeographicTilingScheme) {
    "use strict";

    /**
     * A very simple {@link TerrainProvider} that produces geometry to represent the mean sea level as
     * defined in a .dac file.
     *
     * @alias MeanSeaLevelTerrainProvider
     * @constructor
     *
     * @param {TilingScheme} [description.tilingScheme] The tiling scheme specifying how the
     * surface is broken into tiles.  If this parameter is not provided, a {@link GeographicTilingScheme}
     * is used.
     * @param {Ellipsoid} [description.ellipsoid] The ellipsoid.  If the tilingScheme is specified,
     * this parameter is ignored and the tiling scheme's ellipsoid is used instead. If neither
     * parameter is specified, the WGS84 ellipsoid is used.
     *
     * @see TerrainProvider
     */
    var MeanSeaLevelTerrainProvider = function MeanSeaLevelTerrainProvider(description) {
        this._ready = false;

        if (!defined(description) || !defined(description.url)) {
            throw new DeveloperError('description.url is required.');
        }

        this._url = description.url;

        this._tilingScheme = description.tilingScheme;
        if (!defined(this._tilingScheme)) {
            this._tilingScheme = new GeographicTilingScheme({
                numberOfLevelZeroTilesX : 2,
                numberOfLevelZeroTilesY : 1
            });
        }

        this._heightmapStructure = {
            heightScale : 0.01, // The raw data is in cm
            heightOffset : 0.0,
            elementsPerHeight : 1,
            stride : 1,
            elementMultiplier : 256.0,
            isBigEndian : false
        };

        // Note: the 65 below does NOT need to match the actual vertex dimensions, because
        // mean sea level is significantly smoother than actual terrain.
        this._levelZeroMaximumGeometricError = TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(this._tilingScheme.ellipsoid, 65, this._tilingScheme.getNumberOfXTilesAtLevel(0));

        this._heightmapWidth = 17;
        this._heightmapHeight = 17;
        this._terrainData = new HeightmapTerrainData({
            buffer : new Uint8Array(this._heightmapWidth * this._heightmapHeight),
            width : this._heightmapWidth,
            height : this._heightmapHeight
        });

        // From: http://earth-info.nga.mil/GandG/wgs84/gravitymod/egm96/egm96.html
        //
        // The total size of the file is 2,076,480 bytes. This file was created
        // using an INTEGER*2 data type format and is an unformatted direct access
        // file. The data on the file is arranged in records from north to south.
        // There are 721 records on the file starting with record 1 at 90 N. The
        // last record on the file is at latitude 90 S. For each record, there
        // are 1,440 15 arc-minute geoid heights arranged by longitude from west to
        // east starting at the Prime Meridian (0 E) and ending 15 arc-minutes west
        // of the Prime Meridian (359.75 E). On file, the geoid heights are in units
        // of centimeters. While retrieving the Integer*2 values on file, divide by
        // 100 and this will produce a geoid height in meters.
        this._numRows = 721;
        this._numCols = 1441; // Only 1440 in File: [0, 359.75),
        // but we copy the wrap around duplicate for [-180, 180] in our array.

        var that = this;

        loadArrayBuffer(that._url).then(function(arrayBuffer){
            var dataView = new DataView(arrayBuffer);
            that._posts = [];

            // The file has the longitudes ordered from 0 to 2pi,
            // but we write them in to our table from -pi to pi.
            for (var rowIndex = 0; rowIndex < that._numRows; rowIndex++){

                that._posts[that._numRows - rowIndex - 1] = [];

                var terrainHeight, byteOffset;
                var colIndex = 0;
                for (; colIndex <= Math.floor(that._numCols / 2); colIndex++){

                    byteOffset = (rowIndex * (that._numCols - 1) + colIndex) * 2;
                    terrainHeight = dataView.getInt16(byteOffset, false);

                    that._posts[that._numRows - rowIndex - 1][colIndex + Math.floor(that._numCols / 2)] = terrainHeight;
                }

                // The first and last points should be identical (being the same point from wrapping around the globe.)
                that._posts[that._numRows - rowIndex - 1][0] = that._posts[that._numRows - rowIndex - 1][that._numCols - 1];

                for (colIndex = Math.floor(that._numCols / 2) + 1; colIndex < that._numCols - 1; colIndex++){

                    byteOffset = (rowIndex * (that._numCols - 1) + colIndex) * 2;
                    terrainHeight = dataView.getInt16(byteOffset, false);

                    that._posts[that._numRows - rowIndex - 1][colIndex - Math.floor(that._numCols / 2)] = terrainHeight;
                }

            }

            that._ready = true;

        });

        this._errorEvent = new Event();
    };

    defineProperties(MeanSeaLevelTerrainProvider.prototype, {
        /**
         * Gets an event that is raised when the terrain provider encounters an asynchronous error.  By subscribing
         * to the event, you will be notified of the error and can potentially recover from it.  Event listeners
         * are passed an instance of {@link TileProviderError}.
         * @memberof MeanSeaLevelTerrainProvider.prototype
         * @type {Event}
         */
        errorEvent : {
            get : function() {
                return this._errorEvent;
            }
        },

        /**
         * Gets the credit to display when this terrain provider is active.  Typically this is used to credit
         * the source of the terrain.  This function should not be called before {@link MeanSeaLevelTerrainProvider#ready} returns true.
         * @memberof MeanSeaLevelTerrainProvider.prototype
         * @type {Credit}
         */
        credit : {
            get : function() {
                return undefined;
            }
        },

        /**
         * Gets the tiling scheme used by this provider.  This function should
         * not be called before {@link MeanSeaLevelTerrainProvider#ready} returns true.
         * @memberof MeanSeaLevelTerrainProvider.prototype
         * @type {GeographicTilingScheme}
         */
        tilingScheme : {
            get : function() {
                return this._tilingScheme;
            }
        },

        /**
         * Gets a value indicating whether or not the provider is ready for use.
         * @memberof MeanSeaLevelTerrainProvider.prototype
         * @type {Boolean}
         */
        ready : {
            get : function() {
                return this._ready;
            }
        }
    });

    function createHeightmapTerrainData(provider, x, y, level) {

        var rectangle = provider._tilingScheme.tileXYToRectangle(x, y, level);

        // The buffer is an array that holds 17 x 17 height values.
        // It is a single dimensional array, row major, south to north and west to east.
        var heightBuffer = [];
        var deltaLat = (rectangle.north - rectangle.south) / 16.0;
        var deltaLon = (rectangle.east - rectangle.west) / 16.0;
        for (var lat = rectangle.south; lat <= rectangle.north; lat += deltaLat){
            for (var lon = rectangle.west; lon <= rectangle.east; lon += deltaLon){
                heightBuffer.push(bilinearInterpolation(provider, lon, lat));
            }
        }

        // We are describing our rectangle with 17x17 posts. Our raw data has posts every quarter degree.
        // So 17 posts take up four degrees. If our rectangle is larger than that, then more accurate sub-samples could
        // be made from the raw data, if not, then upsampling of this rectangle we are handing over is as good as it gets.
        var maxSize = CesiumMath.toRadians(4.0);
        var childMask = 0;
        if (deltaLat > maxSize || deltaLon > maxSize){
            childMask = 15;
        }

        return new HeightmapTerrainData({
            buffer : heightBuffer,
            childTileMask : childMask,
            width : provider._heightmapWidth,
            height : provider._heightmapHeight,
            structure : provider._heightmapStructure
        });
    }

    /**
     * Requests the geometry for a given tile.  This function should not be called before
     * {@link TerrainProvider#ready} returns true.  The result includes terrain
     * data and indicates that all child tiles are available.
     *
     * @memberof MeanSeaLevelTerrainProvider
     *
     * @param {Number} x The X coordinate of the tile for which to request geometry.
     * @param {Number} y The Y coordinate of the tile for which to request geometry.
     * @param {Number} level The level of the tile for which to request geometry.
     * @param {Boolean} [throttleRequests=true] True if the number of simultaneous requests should be limited,
     *                  or false if the request should be initiated regardless of the number of requests
     *                  already in progress.
     * @returns {Promise|TerrainData} A promise for the requested geometry.  If this method
     *          returns undefined instead of a promise, it is an indication that too many requests are already
     *          pending and the request will be retried later.
     */
    MeanSeaLevelTerrainProvider.prototype.requestTileGeometry = function(x, y, level, throttleRequests) {
        //>>includeStart('debug', pragmas.debug)
        if (!this._ready) {
            throw new DeveloperError('requestTileGeometry must not be called before the terrain provider is ready.');
        }
        //>>includeEnd('debug');

        return createHeightmapTerrainData(this, x, y, level);
    };

    function bilinearInterpolation(provider, longitude, latitude){
        //>>includeStart('debug', pragmas.debug)
        if (!provider._ready) {
            throw new DeveloperError('bilinearInterpolation must not be called before the terrain provider is ready.');
        }
        //>>includeEnd('debug');

        var local = localRegion(provider, longitude, latitude);

        var deltaLon = local.east - local.west;
        var deltaLat = local.north - local.south;

        var dX = (longitude - local.west) / deltaLon;
        var dY = (latitude - local.south) / deltaLat;
        var dXdY = dX * dY;

        return (1 - dX - dY + dXdY) * local.swElev +
               (dX - dXdY) * local.seElev +
               (dY - dXdY) * local.nwElev +
               (dXdY) * local.neElev;

    }
    MeanSeaLevelTerrainProvider._bilinearInterpolation = bilinearInterpolation;

    function localRegion(provider, longitude, latitude){
        //>>includeStart('debug', pragmas.debug)
        if (!provider._ready) {
            throw new DeveloperError('localRegion must not be called before the terrain provider is ready.');
        }
        //>>includeEnd('debug');

        longitude = CesiumMath.convertLongitudeRange(longitude);

        // The row index goes from 0 at the south pole to 720 at the south north, with a row every quarter
        // of a degree.
        var entriesPerRadian = 720 / Math.PI;
        var latitudeIndex = (latitude + CesiumMath.PI_OVER_TWO) * entriesPerRadian;
        var longitudeIndex = (longitude + Math.PI) * entriesPerRadian;

        var local = { };
        var westIndex = Math.floor(longitudeIndex);
        var eastIndex = westIndex + 1;
        var southIndex = Math.floor(latitudeIndex);
        if (southIndex < 0){
            southIndex = 0;
        }
        else if (southIndex === provider._numRows - 1){
            southIndex--;
        }
        var northIndex = southIndex + 1;

        local.west = westIndex / entriesPerRadian - Math.PI;
        local.east = eastIndex / entriesPerRadian - Math.PI;
        local.north = (northIndex / entriesPerRadian) - CesiumMath.PI_OVER_TWO;
        local.south = (southIndex / entriesPerRadian) - CesiumMath.PI_OVER_TWO;

        local.nwElev = provider._posts[northIndex][westIndex];
        local.neElev = provider._posts[northIndex][eastIndex];
        local.swElev = provider._posts[southIndex][westIndex];
        local.seElev = provider._posts[southIndex][eastIndex];

        return local;
    }

    /**
     * Gets the maximum geometric error allowed in a tile at a given level.
     *
     * @memberof MeanSeaLevelTerrainProvider
     *
     * @param {Number} level The tile level for which to get the maximum geometric error.
     * @returns {Number} The maximum geometric error.
     */
    MeanSeaLevelTerrainProvider.prototype.getLevelMaximumGeometricError = function(level) {
        return this._levelZeroMaximumGeometricError / (1 << level);
    };

    /**
     * Gets a value indicating whether or not the provider includes a water mask.  The water mask
     * indicates which areas of the globe are water rather than land, so they can be rendered
     * as a reflective surface with animated waves.
     *
     * @memberof MeanSeaLevelTerrainProvider
     *
     * @returns {Boolean} True if the provider has a water mask; otherwise, false.
     */
    MeanSeaLevelTerrainProvider.prototype.hasWaterMask = function() {
        return false;
    };

    return MeanSeaLevelTerrainProvider;
});