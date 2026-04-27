[**light-runner v0.10.0**](../index.md)

***

[light-runner](../index.md) / RunResult

# Interface: RunResult

Defined in: [src/types.ts:81](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L81)

## Properties

### cancelled

```ts
cancelled: boolean;
```

Defined in: [src/types.ts:85](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L85)

***

### duration

```ts
duration: number;
```

Defined in: [src/types.ts:84](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L84)

***

### exitCode

```ts
exitCode: number;
```

Defined in: [src/types.ts:83](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L83)

***

### extracted?

```ts
optional extracted?: ExtractResult[];
```

Defined in: [src/types.ts:87](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L87)

Status of each requested extract. Present only if `extract` was set.

***

### success

```ts
success: boolean;
```

Defined in: [src/types.ts:82](https://github.com/enixCode/light-runner/blob/58eee63ecac117ef991d9058af46e000f0328c6c/src/types.ts#L82)
