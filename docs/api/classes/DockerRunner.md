[**light-runner v0.10.0**](../index.md)

***

[light-runner](../index.md) / DockerRunner

# Class: DockerRunner

Defined in: [src/DockerRunner.ts:36](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/DockerRunner.ts#L36)

## Constructors

### Constructor

```ts
new DockerRunner(options?): DockerRunner;
```

Defined in: [src/DockerRunner.ts:39](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/DockerRunner.ts#L39)

#### Parameters

##### options?

[`RunnerOptions`](../interfaces/RunnerOptions.md) = `{}`

#### Returns

`DockerRunner`

## Methods

### run()

```ts
run(request): Execution;
```

Defined in: [src/DockerRunner.ts:49](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/DockerRunner.ts#L49)

#### Parameters

##### request

[`RunRequest`](../interfaces/RunRequest.md)

#### Returns

[`Execution`](Execution.md)

***

### attach()

```ts
static attach(id): Execution | null;
```

Defined in: [src/DockerRunner.ts:252](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/DockerRunner.ts#L252)

#### Parameters

##### id

`string`

#### Returns

[`Execution`](Execution.md) \| `null`

***

### cleanupOrphanStates()

```ts
static cleanupOrphanStates(): Promise<number>;
```

Defined in: [src/DockerRunner.ts:345](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/DockerRunner.ts#L345)

#### Returns

`Promise`\<`number`\>

***

### cleanupOrphanVolumes()

```ts
static cleanupOrphanVolumes(): Promise<number>;
```

Defined in: [src/DockerRunner.ts:243](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/DockerRunner.ts#L243)

#### Returns

`Promise`\<`number`\>

***

### isAvailable()

```ts
static isAvailable(): Promise<boolean>;
```

Defined in: [src/DockerRunner.ts:234](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/DockerRunner.ts#L234)

#### Returns

`Promise`\<`boolean`\>

***

### list()

```ts
static list(): RunState[];
```

Defined in: [src/DockerRunner.ts:335](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/DockerRunner.ts#L335)

#### Returns

[`RunState`](../interfaces/RunState.md)[]

***

### reapOrphans()

```ts
static reapOrphans(): Promise<{
  containers: number;
  volumes: number;
}>;
```

Defined in: [src/DockerRunner.ts:367](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/DockerRunner.ts#L367)

#### Returns

`Promise`\<\{
  `containers`: `number`;
  `volumes`: `number`;
\}\>
