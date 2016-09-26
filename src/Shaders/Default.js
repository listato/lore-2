Lore.Shaders['default'] = new Lore.Shader('Default', {}, [
    'attribute vec3 position;',
    'attribute vec3 color;',
    'varying vec3 vColor;',
    'void main() {',
        'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        'vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
        'gl_PointSize = 5.0 * (1000.0 / length(mvPosition.xyz));',
        'vColor = color;',
    '}'
], [
    'varying vec3 vColor;',
    'void main() {',
        'gl_FragColor = vec4(vColor, 1.0);',
    '}'
]);
