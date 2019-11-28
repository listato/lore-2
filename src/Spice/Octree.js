//@ts-check

const AABB = require('./AABB');
const Vector3f = require('../Math/Vector3f');
const ProjectionMatrix = require('../Math/ProjectionMatrix');
const Utils = require('../Utils/Utils');
const Raycaster = require('./Raycaster');
const RadixSort = require('../Math/RadixSort');

/** 
 * @class
 * An octree constructed using the point cloud.
 * @property {number} threshold - A threshold indicating whether or not a further subdivision is needed based on the number of data points in the current node.
 * @property {number} maxDepth - A maximum depth of the octree.
 * @property {Object} points - An object storing the points belonging to each node indexed by the location id of the node.
 * @property {Object} aabbs - An object storing the axis-aligned bounding boxes belonging to each node indexed by the location id of the node.
 * @constructor
 * @param {number} threshold - A threshold indicating whether or not a further subdivision is needed based on the number of data points in the current node.
 * @param {number} maxDepth - A maximum depth of the octree.
 */

class Octree {
  constructor(threshold, maxDepth) {
    this.threshold = threshold || 500;
    this.maxDepth = maxDepth || 8;
    this.points = {};
    this.aabbs = {};

    this.offsets = [
      [-0.5, -0.5, -0.5],
      [-0.5, -0.5, +0.5],
      [-0.5, +0.5, -0.5],
      [-0.5, +0.5, +0.5],
      [+0.5, -0.5, -0.5],
      [+0.5, -0.5, +0.5],
      [+0.5, +0.5, -0.5],
      [+0.5, +0.5, +0.5]
    ];
  }

  /**
   * Builds the octree by assigning the indices of data points and axis-aligned bounding boxes to assoziative arrays indexed by the location code.
   * @param {Uint32Array} pointIndices - An set of points that are either sub-divided into sub nodes or assigned to the current node.
   * @param {Float32Array} vertices - An array containing the positions of all the vertices.
   * @param {AABB} aabb - The bounding box of the current node.
   * @param {number} [locCode=1] - A binary code encoding the id and the level of the current node.
   */
  build(pointIndices, vertices, aabb, locCode = 1) {
    // Set the location code of the axis-aligned bounding box
    aabb.setLocCode(locCode);

    // Store the axis aligned bounding box of this node
    // and set the points belonging to the node to null
    this.points[locCode] = null;
    this.aabbs[locCode] = aabb;

    // Check if this node reaches the maximum depth or the threshold
    let depth = this.getDepth(locCode);

    if (pointIndices.length <= this.threshold || depth >= this.maxDepth) {
      this.points[locCode] = new Uint32Array(pointIndices.length);
      for (var i = 0; i < pointIndices.length; i++) {
        this.points[locCode][i] = pointIndices[i];
      }

      return true;
    }

    let childPointCounts = new Uint32Array(8);
    let codes = new Float32Array(pointIndices.length);

    for (var i = 0; i < pointIndices.length; i++) {
      // Points are indices to the vertices array
      // which stores x,y,z coordinates linear
      let k = pointIndices[i] * 3;

      // Assign point to subtree, this gives a code
      // 000, 001, 010, 011, 100, 101, 110, 111
      // (-> 8 possible subtrees)
      if (vertices[k + 0] >= aabb.center.components[0]) codes[i] |= 4;
      if (vertices[k + 1] >= aabb.center.components[1]) codes[i] |= 2;
      if (vertices[k + 2] >= aabb.center.components[2]) codes[i] |= 1;

      childPointCounts[codes[i]]++;
    }

    let nextPoints = new Array(8);
    let nextAabb = new Array(8);

    for (var i = 0; i < 8; i++) {
      if (childPointCounts[i] == 0) continue;
      nextPoints[i] = new Uint32Array(childPointCounts[i]);

      for (var j = 0, k = 0; j < pointIndices.length; j++) {
        if (codes[j] == i) {
          nextPoints[i][k++] = pointIndices[j];
        }
      }

      let o = this.offsets[i];
      let offset = new Vector3f(o[0], o[1], o[2]);
      offset.multiplyScalar(aabb.radius);
      nextAabb[i] = new AABB(aabb.center.clone().add(offset), 0.5 * aabb.radius);
    }

    for (var i = 0; i < 8; i++) {
      if (childPointCounts[i] == 0) {
        continue;
      }

      let nextLocCode = this.generateLocCode(locCode, i);
      this.build(nextPoints[i], vertices, nextAabb[i], nextLocCode);
    }

    return this;
  }

  /**
   * Returns an array containing the location codes of all the axis-aligned
   * bounding boxes inside this octree.
   */
  getLocCodes() {
    return Object.keys(this.aabbs);
  }

  /**
   * Calculates the depth of the node from its location code.
   * @param {number} locCode - A binary code encoding the id and the level of the current node.
   * @returns {number} The depth of the node with the provided location code.
   */
  getDepth(locCode) {
    // If the msb is at position 6 (e.g. 1000000) the
    // depth is 2, since the locCode contains two nodes (2 x 3 bits)
    return Utils.msb(locCode) / 3;
  }

  /**
   * Generates a location code for a node based on the full code of the parent and the code of the current node.
   * @param {number} parentCode The full location code of the parent node.
   * @param {number} nodeCode The 3 bit code of the current node.
   * @returns {number} The full location code for the current node.
   */
  generateLocCode(parentCode, nodeCode) {
    // Insert the code of this new node, just before the msb (that is set to 1)
    // of the parents code
    let msb = Utils.msb(parentCode);

    if (msb == -1) {
      return nodeCode | 8;
    } else {
      // Left-shift the parent code by msb
      parentCode = parentCode <<= 3;
      // OR parent code with node code
      return parentCode | nodeCode;
    }
  }

  /**
   * Traverses the octree depth-first.
   * @param {Function} traverseCallback - Is called for each node where a axis-aligned bounding box exists.
   * @param {number} [locCode=1] - The location code of the node that serves as the starting node for the traversion.
   */
  traverse(traverseCallback, locCode = 1) {
    for (var i = 0; i < 8; i++) {
      let next = locCode << 3 | i;

      // If it has an aabb, it exists
      if (this.aabbs[next]) {
        traverseCallback(this.points[next], this.aabbs[next], next);
        this.traverse(traverseCallback, next);
      }
    }
  }

  /**
   * Traverses the octree depth-first, does not visit nodes / subtrees if a condition is not met.
   * @param {Function} traverseIfCallback - Is called for each node where a axis-aligned bounding box exists and returns either true or false, with false stopping further exploration of the subtree.
   * @param {Function} conditionCallback - Is called to test whether or not a subtree should be explored.
   * @param {number} [locCode=1] - The location code of the node that serves as the starting node for the traversion.
   */
  traverseIf(traverseIfCallback, conditionCallback, locCode = 1) {
    for (var i = 0; i < 8; i++) {
      let next = locCode << 3 | i;

      // If it has an aabb, it exists
      if (this.aabbs[next]) {
        if (!conditionCallback(this.aabbs[next], next)) {
          continue;
        }

        traverseIfCallback(this.points[next], this.aabbs[next], next);
        this.traverseIf(traverseIfCallback, conditionCallback, next);
      }
    }
  }

  /**
   * Searches for octree nodes that are intersected by the ray and returns all the points associated with those nodes.
   * @param {Raycaster} raycaster - The raycaster used for checking for intersects.
   * @returns {Array} A set of points which are associated with octree nodes intersected by the ray.
   */
  raySearch(raycaster) {
    let result = [];

    // Info: shouldn't be necessary any more
    // Always add the points from the root
    // The root has the location code 1
    // ... looks like it's still necessary
    if (this.points[1]) {
      for (var i = 0; i < this.points[1].length; i++) {
        result.push({
          index: this.points[1][i],
          locCode: 1
        });
      }
    }

    // Calculate the direction, and the percentage
    // of the direction, of the ray
    let dir = raycaster.ray.direction.clone();
    dir.normalize();

    let inverseDir = new Vector3f(1, 1, 1);
    inverseDir.divide(dir);

    this.traverseIf(function (points, aabb, locCode) {
      // If there is an aabb, that contains no points but only
      // nodes, skip here
      if (!points) {
        return;
      }

      for (var i = 0; i < points.length; i++) {
        result.push({
          index: points[i],
          locCode: locCode
        });
      }
    }, function (aabb, locCode) {
      return aabb.cylinderTest(raycaster.ray.source, inverseDir,
        raycaster.far, raycaster.threshold);
    });

    return result;
  }

  /**
   * Returns the locCodes and number of points of axis aligned bounding boxes that are intersected by a box defined by min and max vectors. Boxes not containing any points are ignored.
   * @param {Vector3f} min - The minima of the box.
   * @param {Vector3f} max - The maxima of the box.
   * @returns {Array} An array containing locCodes and the number of points of the intersected axis aligned bounding boxes.
   */
  intersectBox(min, max) {
    let result = [];

    console.log(this.aabbs);

    // console.log(min, max);

    this.traverseIf(function (points, aabb, locCode) {
      if (!points) {
        return;
      }

      console.log(locCode, points.length);
    }, function (aabb, locCode) {
      // console.log(min, max);
      // console.log(aabb);
      // console.log(locCode);
      return !((min.getX() < aabb.max[0]) && (max.getX() > aabb.min[0]) &&
             (min.getY() < aabb.max[1]) && (max.getY() > aabb.min[1]) &&
             (min.getZ() < aabb.max[2]) && (max.getZ() > aabb.min[2]));
    });

    return result;
  }

  /**
   * Returns an array containing all the centers of the axis-aligned bounding boxes
   * in this octree that have points associated with them.
   * @returns {Array} An array containing the centers as Lore.Vector3f objects.
   */
  getCenters(threshold) {
    threshold = threshold || 0;
    let centers = new Array();

    this.traverse(function (points, aabb, next) {
      if (points && points.length > threshold) {
        centers.push(aabb.center);
      }
    });

    return centers;
  }

  /**
   * This function returns the closest box in the octree to the point given as an argument.
   * @param {Vector3f} point - The point.
   * @param {number} threshold - The minimum number of points an axis-aligned bounding box should contain to count as a hit.
   * @param {number} [locCode=1] - The starting locCode, if not set, starts at the root.
   * @returns {AABB} The closest axis-aligned bounding box to the input point.
   */
  getClosestBox(point, threshold, locCode = 1) {
    let closest = -1;
    let minDist = Number.MAX_VALUE;

    for (var i = 0; i < 8; i++) {
      let next = locCode << 3 | i;

      // If it has an aabb, it exists
      if (this.aabbs[next]) {
        // Continue if under threshold
        if (this.points[next] && this.points[next].length < threshold) {
          continue;
        }

        let dist = this.aabbs[next].distanceToPointSq(point.components[0], point.components[1], point.components[2]);
        if (dist < minDist) {
          minDist = dist;
          closest = next;
        }
      }
    }

    if (closest < 0) {
      return this.aabbs[locCode];
    } else {
      return this.getClosestBox(point, threshold, closest);
    }
  }

  /**
   * This function returns the closest box in the octree to the point given as an argument. The distance measured is to the
   * box center.
   * @param {Vector3f} point - The point.
   * @param {number} threshold - The minimum number of points an axis-aligned bounding box should contain to count as a hit.
   * @param {number} [locCode=1] - The starting locCode, if not set, starts at the root.
   * @returns {AABB} The closest axis-aligned bounding box to the input point.
   */
  getClosestBoxFromCenter(point, threshold, locCode = 1) {
    let closest = -1;
    let minDist = Number.MAX_VALUE;

    for (var i = 0; i < 8; i++) {
      let next = locCode << 3 | i;

      // If it has an aabb, it exists
      if (this.aabbs[next]) {
        // Continue if under threshold
        if (this.points[next] && this.points[next].length < threshold) {
          continue;
        }

        let dist = this.aabbs[next].distanceFromCenterToPointSq(point.components[0], point.components[1], point.components[2]);

        if (dist < minDist) {
          minDist = dist;
          closest = next;
        }
      }
    }

    if (closest < 0) {
      return this.aabbs[locCode];
    } else {
      return this.getClosestBox(point, threshold, closest);
    }
  }

  /**
   * This function returns the farthest box in the octree to the point given as an argument.
   * @param {Vector3f} point - The point.
   * @param {number} threshold - The minimum number of points an axis-aligned bounding box should contain to count as a hit.
   * @param {number} [locCode=1] - The starting locCode, if not set, starts at the root.
   * @returns {AABB} The farthest axis-aligned bounding box to the input point.
   */
  getFarthestBox(point, threshold, locCode) {
    let farthest = -1;
    let maxDist = Number.MIN_VALUE;

    for (var i = 0; i < 8; i++) {
      let next = locCode << 3 | i;

      // If it has an aabb, it exists
      if (this.aabbs[next]) {
        // Continue if under threshold
        if (this.points[next] && this.points[next].length < threshold) {
          continue;
        }

        let dist = this.aabbs[next].distanceToPointSq(point.components[0], point.components[1], point.components[2]);
        if (dist > maxDist) {
          maxDist = dist;
          farthest = next;
        }
      }
    }

    if (farthest < 0) {
      return this.aabbs[locCode];
    } else {
      return this.getFarthestBox(point, threshold, farthest);
    }
  }

  /**
   * Finds the closest point inside the octree to the point provided as an argument.
   * @param {Vector3f} point - The point.
   * @param {Float32Array} positions - An array containing the positions of the points.
   * @param {number} threshold - Only consider points inside a axis-aligned bounding box with a minimum of [threshold] points.
   * @param {number} locCode - If specified, the axis-aligned bounding box in which the point is searched for. If not set, all boxes are searched.
   * @returns {Vector3f} The position of the closest point.
   */
  getClosestPoint(point, positions, threshold, locCode) {
    threshold = threshold || 0;
    let minDist = Number.MAX_VALUE;
    let result = null;

    let box = null;

    if (locCode) {
      box = this.aabbs[locCode];
    } else {
      box = this.getClosestBox(point, threshold);
    }

    let boxPoints = this.points[box.getLocCode()];

    // If the box does not contain any points
    if (!boxPoints) {
      return null;
    }

    for (var i = 0; i < boxPoints.length; i++) {
      let index = boxPoints[i];
      index *= 3;
      let x = positions[index];
      let y = positions[index + 1];
      let z = positions[index + 2];

      let pc = point.components;

      let distSq = Math.pow(pc[0] - x, 2) + Math.pow(pc[1] - y, 2) + Math.pow(pc[2] - z, 2);
      if (distSq < minDist) {
        minDist = distSq;
        result = {
          x: x,
          y: y,
          z: z
        };
      }
    }

    if (!result) {
      return null;
    }

    return new Vector3f(result.x, result.y, result.z);
  }

  /**
   * Finds the farthest point inside the octree to the point provided as an argument.
   * @param {Vector3f} point - The point.
   * @param {Float32Array} positions - An array containing the positions of the points.
   * @param {number} threshold - Only consider points inside a axis-aligned bounding box with a minimum of [threshold] points.
   * @param {number} locCode - If specified, the axis-aligned bounding box in which the point is searched for. If not set, all boxes are searched.
   * @returns {Vector3f} The position of the farthest point.
   */
  getFarthestPoint(point, positions, threshold, locCode) {
    threshold = threshold || 0;
    let maxDist = Number.MIN_VALUE;
    let result = null;

    // Get farthest box
    let box = null;

    if (locCode) {
      box = this.aabbs[locCode];
    } else {
      box = this.getFarthestBox(point, threshold);
    }

    let boxPoints = this.points[box.getLocCode()];

    // If the box does not contain any points
    if (!boxPoints) {
      return null;
    }

    for (var i = 0; i < boxPoints.length; i++) {
      let index = boxPoints[i];
      index *= 3;
      let x = positions[index];
      let y = positions[index + 1];
      let z = positions[index + 2];

      let pc = point.components;

      let distSq = Math.pow(pc[0] - x, 2) + Math.pow(pc[1] - y, 2) + Math.pow(pc[2] - z, 2);
      if (distSq > maxDist) {
        maxDist = distSq;
        result = {
          x: x,
          y: y,
          z: z
        };
      }
    }

    if (!result) {
      return null;
    }

    return new Vector3f(result.x, result.y, result.z);
  }

  /**
   * Returns the parent of a given location code by simply shifting it to the right by tree, removing the current code.
   * @param {number} locCode - The location code of a node.
   */
  getParent(locCode) {
    return locCode >>> 3;
  }

  /**
   * Find neighbouring axis-aligned bounding boxes.
   * @param {number} locCode - The location code of the axis-aligned bounding box whose neighbours will be returned
   * @returns {Array} An array of location codes of the neighbouring axis-aligned bounding boxes.
   */
  getNeighbours(locCode) {
    let self = this;
    let locCodes = new Array();

    this.traverseIf(function (points, aabbs, code) {
      if (points && points.length > 0 && code != locCode) {
        locCodes.push(code);
      }
    }, function (aabb, code) {
      // Exit branch if this node is not a neighbour
      return aabb.testAABB(self.aabbs[locCode]);
    });

    return locCodes;
  }

  /**
   * Returns the k-nearest neighbours of a vertex.
   * @param {number} k - The number of nearest neighbours to return.
   * @param {number} point - The index of a vertex or a vertex.
   * @param {number} locCode - The location code of the axis-aligned bounding box containing the vertex. If not set, the box is searched for.
   * @param {Float32Array} positions - The position information for the points indexed in this octree.
   * @param {Function} kNNCallback - The callback that is called after the k-nearest neighbour search has finished.
   */
  kNearestNeighbours(k, point, locCode, positions, kNNCallback) {
    k += 1; // Account for the fact, that the point itself should be returned as well.
    let length = positions.length / 3;
    let p = point;

    // TODO: WTF is happening here
    if (!isNaN(parseFloat(point))) {
      let p = {
        x: positions[p * 3],
        y: positions[p * 3 + 1],
        z: positions[p * 3 + 2]
      };
    }

    if (locCode === null) {
      locCode = this.getClosestBoxFromCenter(new Vector3f(p.x, p.y, p.z), 0).locCode;
    }

    // Calculte the distances to the other cells
    let cellDistances = this.getCellDistancesToPoint(p.x, p.y, p.z, locCode);

    // Calculte the distances to the other points in the same cell
    let pointDistances = this.pointDistancesSq(p.x, p.y, p.z, locCode, positions)

    // Sort the indices according to distance
    let radixSort = new RadixSort();
    let sortedPointDistances = radixSort.sort(pointDistances.distancesSq, true);

    // Sort the neighbours according to distance
    let sortedCellDistances = radixSort.sort(cellDistances.distancesSq, true);

    // Since the closest points always stay the closest points event when adding
    // the points of another cell, instead of resizing the array, just define
    // an offset
    let pointOffset = 0;

    // Get all the neighbours from this cell that are closer than the nereast box
    let indexCount = 0;
    let indices = new Uint32Array(k);

    for (var i = 0; indexCount < k && i < sortedPointDistances.array.length; i++) {
      // Break if closest neighbouring cell is closer than the closest remaining point
      if (sortedPointDistances.array[i] > sortedCellDistances.array[0]) {
        // Set the offset to the most distant closest member
        pointOffset = i;
        break;
      }

      indices[i] = pointDistances.indices[sortedPointDistances.indices[i]];
      indexCount++;
    }

    // If enough neighbours have been found in the same cell, no need to continue
    if (indexCount == k) {
      return indices;
    }

    for (var i = 0; i < sortedCellDistances.array.length; i++) {
      // Get the points from the cell and merge them with the already found ones
      let locCode = cellDistances.locCodes[sortedCellDistances.indices[i]];
      let newPointDistances = this.pointDistancesSq(p.x, p.y, p.z, locCode, positions);

      pointDistances = Octree.mergePointDistances(pointDistances, newPointDistances);

      // Sort the merged points
      let sortedNewPointDistances = radixSort.sort(pointDistances.distancesSq, true);

      for (var j = pointOffset; indexCount < k && j < sortedNewPointDistances.array.length; j++) {
        if (sortedNewPointDistances.array[j] > sortedCellDistances.array[i + 1]) {
          pointOffset = j;
          break;
        }

        indices[j] = pointDistances.indices[sortedNewPointDistances.indices[j]];
        indexCount++;
      }

      if (indexCount == k || indexCount >= length - 1) {
        // kNNCallback(indices);
        return indices;
      }
    }

    //kNNCallback(indices);
    return indices;
  }

  /**
   * Calculates the distances from a given point to all of the cells containing points
   * @param {number} x - The x-value of the coordinate.
   * @param {number} y - The y-value of the coordinate.
   * @param {number} z - The z-value of the coordinate.
   * @param {number} locCode - The location code of the cell containing the point.
   * @returns {Object} An object containing arrays for the locCodes and the squred distances.
   */
  getCellDistancesToPoint(x, y, z, locCode) {
    let locCodes = new Array();

    this.traverse(function (points, aabb, code) {
      if (points && points.length > 0 && code != locCode) {
        locCodes.push(code);
      }
    });

    let dists = new Float32Array(locCodes.length);
    for (var i = 0; i < locCodes.length; i++) {
      dists[i] = this.aabbs[locCodes[i]].distanceToPointSq(x, y, z);
    }

    return {
      locCodes: locCodes,
      distancesSq: dists
    };
  }

  /**
   * Expands the current neighbourhood around the cell where the point specified by x, y, z is in.
   * @param {number} x - The x-value of the coordinate.
   * @param {number} y - The y-value of the coordinate.
   * @param {number} z - The z-value of the coordinate.
   * @param {number} locCode - The location code of the cell containing the point.
   * @param {Object} cellDistances - The object containing location codes and distances.
   * @returns {number} The number of added location codes.
   */
  expandNeighbourhood(x, y, z, locCode, cellDistances) {
    let locCodes = cellDistances.locCodes;
    let distancesSq = cellDistances.distancesSq;
    let length = locCodes.length;

    for (var i = length - 1; i >= 0; i--) {
      let neighbours = this.getNeighbours(locCodes[i]);

      for (var j = 0; j < neighbours.length; j++) {
        if (neighbours[j] !== locCode && !Utils.arrayContains(locCodes, neighbours[j])) {
          locCodes.push(neighbours[j]);
        }
      }
    }

    // Update the distances
    let l1 = locCodes.length;
    let l2 = distancesSq.length;

    if (l1 === l2) {
      return;
    }

    let dists = new Float32Array(l1 - l2);

    for (var i = l2, c = 0; i < l1; i++, c++) {
      dists[c] = this.aabbs[locCodes[i]].distanceToPointSq(x, y, z);
    }

    cellDistances.distancesSq = Utils.concatTypedArrays(distancesSq, dists);

    return locCodes.length - length;
  }

  /**
   * Returns a list of the cells neighbouring the cell with the provided locCode and the point specified by x, y and z.
   * @param {number} x - The x-value of the coordinate.
   * @param {number} y - The y-value of the coordinate.
   * @param {number} z - The z-value of the coordinate.
   * @param {number} locCode - The number of the axis-aligned bounding box.
   * @returns {Object} An object containing arrays for the locCodes and the squred distances.
   */
  cellDistancesSq(x, y, z, locCode) {
    let locCodes = this.getNeighbours(locCode);

    let dists = new Float32Array(locCodes.length);

    for (var i = 0; i < locCodes.length; i++) {
      dists[i] = this.aabbs[locCodes[i]].distanceToPointSq(x, y, z);
    }

    return {
      locCodes: locCodes,
      distancesSq: dists
    };
  }

  /**
   * Returns a list of the the squared distances of the points contained in the axis-aligned bounding box to the provided coordinates.
   * @param {number} x - The x-value of the coordinate.
   * @param {number} y - The y-value of the coordinate.
   * @param {number} z - The z-value of the coordinate.
   * @param {number} locCode - The number of the axis-aligned bounding box.
   * @param {Float32Array} positions - The array containing the vertex coordinates.
   * @returns {Object} An object containing arrays for the indices and distances.
   */
  pointDistancesSq(x, y, z, locCode, positions) {
    let points = this.points[locCode];
    let indices = new Uint32Array(points.length);
    let dists = new Float32Array(points.length);

    for (var i = 0; i < points.length; i++) {
      let index = points[i] * 3;
      let x2 = positions[index];
      let y2 = positions[index + 1];
      let z2 = positions[index + 2];

      indices[i] = points[i];
      dists[i] = Math.pow(x2 - x, 2) + Math.pow(y2 - y, 2) + Math.pow(z2 - z, 2);
    }
    return {
      indices: indices,
      distancesSq: dists
    };
  }

  /**
   * Concatenates the two typed arrays a and b and returns a new array. The two arrays have to be of the same type.
   * Due to performance reasons, there is no check whether the types match.
   * @param {Array} a - The first array.
   * @param {Array} b - The second array.
   * @returns {Array} The concatenated array.
   */
  static concatTypedArrays(a, b) {
    let c = new a.constructor(a.length + b.length);

    c.set(a);
    c.set(b, a.length);

    return c;
  }

  /**
   * Merges the two arrays (indices and distancesSq) in the point distances object.
   * @param {Object} a - The first point distances object.
   * @param {Object} b - The second point distances object.
   * @returns {Object} The concatenated point distances object.
   */
  static mergePointDistances(a, b) {
    let newObj = {};

    newObj.indices = Octree.concatTypedArrays(a.indices, b.indices);
    newObj.distancesSq = Octree.concatTypedArrays(a.distancesSq, b.distancesSq);

    return newObj;
  }

  /**
   * Merges the two arrays (locCodes and distancesSq) in the cell distances object.
   * @param {Object} a - The first cell distances object.
   * @param {Object} b - The second cell distances object.
   * @returns {Object} The concatenated cell distances object.
   */
  static mergeCellDistances(a, b) {
    let newObj = {};

    newObj.locCodes = Octree.concatTypedArrays(a.locCodes, b.locCodes);
    newObj.distancesSq = Octree.concatTypedArrays(a.distancesSq, b.distancesSq);

    return newObj;
  }

  /**
   * Clones an octree.
   * @param {Octree} original - The octree to be cloned.
   * @returns {Octree} The cloned octree.
   */
  static clone(original) {
    let clone = new Octree();

    clone.threshold = original.threshold;
    clone.maxDepth = original.maxDepth;
    clone.points = original.points;

    for (var property in original.aabbs) {
      if (original.aabbs.hasOwnProperty(property)) {
        clone.aabbs[property] = AABB.clone(original.aabbs[property]);
      }
    }

    return clone;
  }
}

module.exports = Octree