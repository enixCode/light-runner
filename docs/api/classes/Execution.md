[**light-runner v0.10.0**](../index.md)

***

[light-runner](../index.md) / Execution

# Class: Execution

Defined in: [src/Execution.ts:17](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/Execution.ts#L17)

## Constructors

### Constructor

```ts
new Execution(
   id, 
   result, 
   onCancel): Execution;
```

Defined in: [src/Execution.ts:22](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/Execution.ts#L22)

#### Parameters

##### id

`string`

##### result

`Promise`\<[`RunResult`](../interfaces/RunResult.md)\>

##### onCancel

() => `void`

#### Returns

`Execution`

## Properties

### id

```ts
readonly id: string;
```

Defined in: [src/Execution.ts:18](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/Execution.ts#L18)

***

### result

```ts
readonly result: Promise<RunResult>;
```

Defined in: [src/Execution.ts:19](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/Execution.ts#L19)

## Accessors

### cancelled

#### Get Signature

```ts
get cancelled(): boolean;
```

Defined in: [src/Execution.ts:45](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/Execution.ts#L45)

##### Returns

`boolean`

## Methods

### cancel()

```ts
cancel(): void;
```

Defined in: [src/Execution.ts:36](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/Execution.ts#L36)

#### Returns

`void`

***

### pause()

```ts
pause(): Promise<void>;
```

Defined in: [src/Execution.ts:92](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/Execution.ts#L92)

#### Returns

`Promise`\<`void`\>

***

### resume()

```ts
resume(): Promise<void>;
```

Defined in: [src/Execution.ts:100](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/Execution.ts#L100)

#### Returns

`Promise`\<`void`\>

***

### stop()

```ts
stop(options?): Promise<void>;
```

Defined in: [src/Execution.ts:54](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/Execution.ts#L54)

#### Parameters

##### options?

[`StopOptions`](../interfaces/StopOptions.md) = `{}`

#### Returns

`Promise`\<`void`\>
