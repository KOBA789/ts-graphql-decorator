import * as assert from 'assert';

import 'reflect-metadata';
import {
  graphql,
  GraphQLScalarType,
  GraphQLObjectType,
  GraphQLInterfaceType,
  GraphQLUnionType,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,

  GraphQLString,
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLInt,
  GraphQLID,

  GraphQLSchema,
} from 'graphql';
const { buildSchema } = require('graphql');

interface GraphQLOutputList extends GraphQLList<GraphQLOutputType> { }
type GraphQLOutputNullableType =
  GraphQLScalarType |
  GraphQLEnumType |
  GraphQLObjectType |
  GraphQLInterfaceType |
  GraphQLUnionType |
  GraphQLOutputList;
type GraphQLOutputType =
  GraphQLOutputNullableType |
  GraphQLNonNull<GraphQLOutputNullableType>;

interface GraphQLInputList extends GraphQLList<GraphQLInputType> { }
type GraphQLInputNullableType =
  GraphQLScalarType |
  GraphQLEnumType |
  GraphQLInputObjectType |
  GraphQLInputList;
type GraphQLInputType =
  GraphQLInputNullableType |
  GraphQLNonNull<GraphQLInputNullableType>;

type GraphQLType =
  GraphQLScalarType |
  GraphQLObjectType |
  GraphQLInterfaceType |
  GraphQLUnionType |
  GraphQLEnumType |
  GraphQLInputObjectType |
  GraphQLList<any> |
  GraphQLNonNull<any>;


type GraphQLFieldResolveFn = (
  source?: any,
  args?: { [argName: string]: any },
  context?: any,
  info?: any,
) => any;

type GraphQLFieldConfig = {
  type: GraphQLOutputType;
  args?: GraphQLFieldConfigArgumentMap;
  resolve?: GraphQLFieldResolveFn;
  deprecationReason?: string;
  description?: string;
}

type GraphQLFieldConfigArgumentMap = {
  [argName: string]: GraphQLArgumentConfig;
};

type GraphQLArgumentConfig = {
  type: GraphQLInputType;
  defaultValue?: any;
  description?: string;
}

const GQL_OBJECT_TYPE = Symbol();
const META_FIELD = Symbol('META_FIELD');
const META_ARGUMENT = Symbol('META_ARGUMENT');
const META_TYPE = Symbol('META_TYPE');
const PARAMTYPES: 'design:paramtypes' = 'design:paramtypes';
const RETURNTYPE: 'design:returntype' = 'design:returntype';
const TYPE: 'design:type' = 'design:type';

type TypeModifier = 'NON_NULL' | 'LIST';

class ArgumentConfig {
  public name: string;
  public type: GraphQLType | Function;
  public typeModifiers: TypeModifier[] = [];
  public defaultValue?: any;
  public description?: string;

  public toConfig(): { [name: string]: GraphQLArgumentConfig } {
    const type = this.typeModifiers.reduce((type, modifier) => {
      switch (modifier) {
        case 'LIST':
          return new GraphQLList(type);
        case 'NON_NULL':
          return new GraphQLNonNull(type);
      }
    }, typeOf(this.type));

    return {
      [this.name]: {
        type: (type as GraphQLInputType),
        defaultValue: this.defaultValue,
        description: this.description,
      }
    };
  }
}

class FieldConfig {
  public name: string;
  public type: GraphQLType | Function;
  public typeModifiers: TypeModifier[] = [];
  public arguments: { [parameterIndex: string]: ArgumentConfig } = {};
  public description?: string;
  public deprecationReason?: string;

  public toConfig(): { [name: string]: GraphQLFieldConfig } {
    const type = this.typeModifiers.reduce((type, modifier) => {
      switch (modifier) {
        case 'LIST':
          return new GraphQLList(type);
        case 'NON_NULL':
          return new GraphQLNonNull(type);
      }
    }, typeOf(this.type));

    return {
      [this.name]: {
        type: (type as GraphQLOutputType),
        args: this.getArgumtentConfigMap(),
        description: this.description,
      }
    };
  }

  private getArgumtentConfigMap() {
    return Object.assign.apply(null, [{}].concat(Object.keys(this.arguments).map((index) => {
      return this.arguments[index].toConfig();
    })));
  }
}

class ParameterMetadata {
  constructor(private methodMetadata: MethodMetadata, private parameterIndex: number) {}

  get type() {
    return this.methodMetadata.paramTypes[this.parameterIndex];
  }

  private get fieldConfig() {
    return this.methodMetadata.fieldConfig;
  }

  public get argumentConfig(): ArgumentConfig {
    const fieldConfig = this.fieldConfig;
    if (!Object.hasOwnProperty.call(fieldConfig.arguments, this.parameterIndex)) {
      const config = new ArgumentConfig();
      config.type = this.type;

      fieldConfig.arguments[this.parameterIndex] = config;
    }

    return fieldConfig.arguments[this.parameterIndex];
  }
}

abstract class MemberMetadata {
  constructor(protected classMetadata: ClassMetadata, protected propertyKey: string | symbol) { }

  public abstract get type(): Function;

  protected get typeConfig() {
    return this.classMetadata.typeConfig;
  }

  public get fieldConfig(): FieldConfig {
    if (!Object.hasOwnProperty.call(this.typeConfig.fields, this.propertyKey)) {
      const config = new FieldConfig();
      if (typeof this.propertyKey === 'string') {
        config.name = this.propertyKey;
      }
      config.type = this.type;

      this.typeConfig.fields[this.propertyKey] = config;
    }

    return this.typeConfig.fields[this.propertyKey];
  }
}

class MethodMetadata extends MemberMetadata {
  public get target(): Object {
    return this.classMetadata.target.prototype;
  }

  public get type(): Function {
    return Reflect.getMetadata(RETURNTYPE, this.target, this.propertyKey);
  }

  public get paramTypes(): Function[] {
    return Reflect.getMetadata(PARAMTYPES, this.target, this.propertyKey);
  }

  public parameterMetadata(parameterIndex: number): ParameterMetadata {
    return new ParameterMetadata(this, parameterIndex);
  }
}

class PropertyMetadata extends MemberMetadata {
  public get type(): Function {
    return Reflect.getMetadata(TYPE, this.classMetadata.target.prototype, this.propertyKey);
  }
}

class TypeConfig {
  public name: string;
  public description?: string;
  public fields: { [propertyKey: string]: FieldConfig } = {};

  public toConfig() {
    const config = {
      name: this.name,
      description: this.description,
      fields: () => (
        Object.assign.apply(null, [{}].concat(
          Object.keys(this.fields).
            map((propertyKey) => this.fields[propertyKey].toConfig())))
      )
    };

    return config;
  }
}

class ClassMetadata {
  constructor(public target: Function) { }

  public get typeConfig(): TypeConfig {
    if (!Reflect.hasMetadata(META_TYPE, this.target)) {
      const initialData = new TypeConfig();
      initialData.name = this.target.name;

      Reflect.defineMetadata(META_TYPE, initialData, this.target);
    }

    return Reflect.getMetadata(META_TYPE, this.target);
  }

  public methodMetadata(propertyKey: string | symbol) {
    return new MethodMetadata(this, propertyKey);
  }

  public propertyMetadata(propertyKey: string | symbol) {
    return new PropertyMetadata(this, propertyKey);
  }
}

function typeName(name: string): ClassDecorator {
  return function (target: Function) {
    new ClassMetadata(target).typeConfig.name = name;
  };
}

function field(name?: string): MethodDecorator & PropertyDecorator {
  return function <T>(target: Object, propertyKey: string | symbol) {
    if (!name) { return; }
    new ClassMetadata(target.constructor).
      methodMetadata(propertyKey).
      fieldConfig.name = name;
  };
}

function arg(name: string): ParameterDecorator {
  return function (target: Object, propertyKey: string | symbol, parameterIndex: number) {
    new ClassMetadata(target.constructor).
      methodMetadata(propertyKey).
      parameterMetadata(parameterIndex).
      argumentConfig.name = name;
  };
}

function description(description: string): ClassDecorator & MethodDecorator & PropertyDecorator & ParameterDecorator {
  return function <T>(target: Object | Function, propertyKey?: string | symbol, third?: TypedPropertyDescriptor<T> | number) {
    if (typeof target === 'function') {
      new ClassMetadata(target).typeConfig.description = description;
    } else if (propertyKey !== undefined) {
      const classMetadata = new ClassMetadata(target.constructor);
      if (typeof third === 'number') {
        // param
        const parameterIndex = third;
        classMetadata.
          methodMetadata(propertyKey).
          parameterMetadata(parameterIndex).
          argumentConfig.description = description;
      } else if (third === undefined) {
        // prop
        classMetadata.
          propertyMetadata(propertyKey).
          fieldConfig.description = description;
      } else {
        // method
        classMetadata.
          methodMetadata(propertyKey).
          fieldConfig.description = description;
      }
    }
  };
}

function defaultValue(value: any): ParameterDecorator {
  return function (target: Object, propertyKey: string, parameterIndex: number) {
    new ClassMetadata(target.constructor).
      methodMetadata(propertyKey).
      parameterMetadata(parameterIndex).
      argumentConfig.defaultValue = value;
  };
}

function type(type: GraphQLInputType & GraphQLOutputType): MethodDecorator & PropertyDecorator & ParameterDecorator;
function type(type: GraphQLInputType): ParameterDecorator;
function type(type: GraphQLOutputType): MethodDecorator & PropertyDecorator;
function type(type: Function): MethodDecorator & PropertyDecorator & ParameterDecorator;
function type(type: GraphQLOutputType | GraphQLInputType | Function): MethodDecorator & PropertyDecorator & ParameterDecorator {
  return function <T>(target: Object, propertyKey: string | symbol, third?: TypedPropertyDescriptor<T> | number) {
    const classMetadata = new ClassMetadata(target.constructor);
    if (typeof third === 'number') {
      // param
      const parameterIndex = third;
      classMetadata.
        methodMetadata(propertyKey).
        parameterMetadata(parameterIndex).
        argumentConfig.type = type;
    } else if (third === undefined) {
      // prop
      classMetadata.
        propertyMetadata(propertyKey).
        fieldConfig.type = type;
    } else {
      // method
      classMetadata.
        methodMetadata(propertyKey).
        fieldConfig.type = type;
    }
  };
}

function typeModifier(modifiter: TypeModifier): MethodDecorator & PropertyDecorator & ParameterDecorator {
  return function <T>(target: Object, propertyKey: string | symbol, third?: TypedPropertyDescriptor<T> | number): void {
    const classMetadata = new ClassMetadata(target.constructor);
    if (typeof third === 'number') {
      // param
      const parameterIndex = third;
      classMetadata.
        methodMetadata(propertyKey).
        parameterMetadata(parameterIndex).
        argumentConfig.typeModifiers.push(modifiter);
    } else if (third === undefined) {
      // prop
      classMetadata.
        propertyMetadata(propertyKey).
        fieldConfig.typeModifiers.push(modifiter);
    } else {
      // method
      classMetadata.
        methodMetadata(propertyKey).
        fieldConfig.typeModifiers.push(modifiter);
    }
  };
}

const list = typeModifier('LIST');
const nonNull = typeModifier('NON_NULL');

function isType(type: any): type is GraphQLType {
  return (
    type instanceof GraphQLScalarType ||
    type instanceof GraphQLObjectType ||
    type instanceof GraphQLInterfaceType ||
    type instanceof GraphQLUnionType ||
    type instanceof GraphQLEnumType ||
    type instanceof GraphQLInputObjectType ||
    type instanceof GraphQLList ||
    type instanceof GraphQLNonNull
  );
}

const typeCache = new Map<Function, GraphQLType>([
  [String, GraphQLString],
  [Number, GraphQLInt],
  [Boolean, GraphQLBoolean],
]);
function typeOf(ctor: GraphQLType): GraphQLType;
function typeOf(ctor: StringConstructor | NumberConstructor | BooleanConstructor): GraphQLScalarType;
function typeOf(ctor: Function): GraphQLObjectType;
function typeOf(ctor: Function | GraphQLType): GraphQLType;
function typeOf(ctor: Function | GraphQLType): GraphQLType {
  if (isType(ctor)) { return ctor; }

  const knownType = typeCache.get(ctor);
  if (knownType !== undefined) { return knownType; }

  const metadata = new ClassMetadata(ctor);
  const config = metadata.typeConfig.toConfig();
  return new GraphQLObjectType(config);
}

export {
  // decorators
  typeName,
  description,
  field,
  type,
  arg,
  defaultValue,
  list,
  nonNull,

  // builders
  typeOf
};
