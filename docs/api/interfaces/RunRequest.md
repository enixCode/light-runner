[**light-runner v0.10.0**](../index.md)

***

[light-runner](../index.md) / RunRequest

# Interface: RunRequest

Defined in: [src/types.ts:34](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L34)

## Properties

### command?

```ts
optional command?: string;
```

Defined in: [src/types.ts:41](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L41)

***

### detached?

```ts
optional detached?: boolean;
```

Defined in: [src/types.ts:78](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L78)

***

### dir?

```ts
optional dir?: string;
```

Defined in: [src/types.ts:48](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L48)

***

### env?

```ts
optional env?: Record<string, string>;
```

Defined in: [src/types.ts:57](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L57)

***

### extract?

```ts
optional extract?: ExtractSpec[];
```

Defined in: [src/types.ts:66](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L66)

***

### image

```ts
image: string;
```

Defined in: [src/types.ts:35](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L35)

***

### input?

```ts
optional input?: unknown;
```

Defined in: [src/types.ts:49](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L49)

***

### network?

```ts
optional network?: string;
```

Defined in: [src/types.ts:56](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L56)

***

### onLog?

```ts
optional onLog?: (line) => void;
```

Defined in: [src/types.ts:60](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L60)

#### Parameters

##### line

`string`

#### Returns

`void`

***

### signal?

```ts
optional signal?: AbortSignal;
```

Defined in: [src/types.ts:59](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L59)

***

### timeout?

```ts
optional timeout?: number;
```

Defined in: [src/types.ts:50](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L50)

***

### workdir?

```ts
optional workdir?: string;
```

Defined in: [src/types.ts:58](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L58)
